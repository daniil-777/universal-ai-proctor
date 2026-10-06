import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import type { StructuredHandoff } from "../domain/review.js";
import { unsupportedReportCharacters } from "./reportErrors.js";
import { reportOverview } from "./reportOverview.js";
import { guardianReportFindings } from "./guardianFindings.js";

const ink = "#14283B", teal = "#007D7A", muted = "#586879", line = "#DCE5EC";
const regular = readFileSync(new URL("./fonts/NotoSans-Regular.ttf", import.meta.url));
const bold = readFileSync(new URL("./fonts/NotoSans-Bold.ttf", import.meta.url));
const symbolRegular = readFileSync(new URL("./fonts/DejaVuSans.ttf", import.meta.url));
const symbolBold = readFileSync(new URL("./fonts/DejaVuSans-Bold.ttf", import.meta.url));
// Reuse the font engine shipped by PDFKit; do not introduce another font dependency.
const fontEngine = await import(import.meta.resolve("fontkit")) as { create: (source: Buffer) => { hasGlyphForCodePoint: (point: number) => boolean } };
const coverage = { Regular: fontEngine.create(regular), Bold: fontEngine.create(bold) };
const checked = { Regular: new Set<number>(), Bold: new Set<number>() };
const symbolCoverage = { Regular: fontEngine.create(symbolRegular), Bold: fontEngine.create(symbolBold) };
// The bundled surgical reference uses arrows and checkmarks. Preserve their
// meaning with a local symbol font, without pretending to support RTL shaping.
const fontFor = (value: string, weight: boolean) => {
  const primary = weight ? "Bold" : "Regular";
  let needsSymbols = false;
  for (const character of value) {
    if (/\s/u.test(character)) continue;
    const point = character.codePointAt(0)!;
    if (checked[primary].has(point)) continue;
    if (coverage[primary].hasGlyphForCodePoint(point)) { checked[primary].add(point); continue; }
    if (point < 0x2190 || point > 0x2BFF || !symbolCoverage[primary].hasGlyphForCodePoint(point)) throw unsupportedReportCharacters();
    needsSymbols = true;
  }
  if (!needsSymbols) return primary;
  for (const character of value) {
    if (!/\s/u.test(character) && !symbolCoverage[primary].hasGlyphForCodePoint(character.codePointAt(0)!)) throw unsupportedReportCharacters();
  }
  return weight ? "SymbolBold" : "SymbolRegular";
};
const plain = (value: unknown) => String(value ?? "").replace(/[\u2010-\u2015]/g, "-");
const escape = (value: unknown) => plain(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clock = (value: number) => {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};
const iso = (value: number) => Number.isFinite(value) ? new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "Not recorded";
const provenance = (value: string, simulated?: boolean) => simulated ? "Demo / simulated" : value === "ai" ? "AI observation" : value === "system" ? "System check" : "Operator record";
const thumbnail = (value?: string) => value && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length <= 52_000 ? value : undefined;
const stats = (data: StructuredHandoff) => ({
  complete: data.progress.filter(step => step.complete).length,
  total: data.progress.length,
  checks: data.operator_checks.filter(check => check.checked).length,
  totalChecks: data.operator_checks.length,
  exceptions: data.open_exceptions.length,
  evidence: data.evidence.length,
});
const snapshotLabel = (data: StructuredHandoff) => `${data.reference.title || "Process session"} · ${data.source.name || data.source.kind}`;
const scopeNotice = "This is a snapshot of recorded samples and operator records, not a continuous assessment of the entire video. Manual confirmations are labeled separately from AI observations.";

/** Editorial PDF with explicit wrapping, verified glyphs and bounded worker execution. */
export async function renderAnalysisPdfDirect(data: StructuredHandoff): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: `Cueveris - ${snapshotLabel(data)}`, Author: "Cueveris", Subject: "Recorded workflow evidence and operator review", CreationDate: new Date(data.generated_at) } });
  doc.registerFont("Regular", regular); doc.registerFont("Bold", bold);
  doc.registerFont("SymbolRegular", symbolRegular); doc.registerFont("SymbolBold", symbolBold);
  const output = new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  const width = doc.page.width - 96, bottom = doc.page.height - 62;
  let y = 48, currentSection = "Executive overview";
  const drawText = (value: string, x: number, position: number, size: number, color: string, weight: boolean, options: PDFKit.Mixins.TextOptions = {}) => {
    const normalized = plain(value), font = fontFor(normalized, weight);
    doc.font(font).fontSize(size).fillColor(color).text(normalized, x, position, { ...options, lineBreak: false });
  };
  // Repeated criteria/notes otherwise ask the font engine to measure the same
  // paragraphs several times. Keep this cache private and bounded per render.
  const wrapCache = new Map<string, string[]>();
  let cachedCharacters = 0;
  const wrap = (value: unknown, size: number, weight: boolean, w: number): string[] => {
    const normalized = plain(value);
    const key = JSON.stringify([size, weight, w, normalized]);
    const cached = wrapCache.get(key);
    if (cached) return cached;
    const measure = (content: string) => doc.font(fontFor(content, weight)).fontSize(size).widthOfString(content);
    const result: string[] = [];
    for (const paragraph of normalized.split(/\r?\n/)) {
      let current = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (measure(next) <= w) { current = next; continue; }
        if (current) { result.push(current); current = ""; }
        let segment = "";
        for (const char of word) { if (segment && measure(segment + char) > w) { result.push(segment); segment = ""; } segment += char; }
        current = segment;
      }
      result.push(current);
    }
    if (key.length <= 8192) {
      while (wrapCache.size >= 512 || cachedCharacters + key.length > 500_000) {
        const oldest = wrapCache.keys().next().value;
        if (oldest === undefined) break;
        wrapCache.delete(oldest); cachedCharacters -= oldest.length;
      }
      wrapCache.set(key, result); cachedCharacters += key.length;
    }
    return result;
  };
  const height = (value: unknown, size = 10, weight = false, w = width) => wrap(value, size, weight, w).length * size * 1.5;
  const newPage = () => {
    doc.addPage();
    drawText("PROCESS GUIDE", 48, 34, 8, teal, true);
    drawText(currentSection.toUpperCase(), 48, 34, 8, muted, false, { width, align: "right" });
    doc.moveTo(48, 55).lineTo(48 + width, 55).strokeColor(line).lineWidth(0.6).stroke();
    y = 76;
  };
  const ensure = (amount: number) => { if (y + Math.min(amount, bottom - 78) > bottom) newPage(); };
  const text = (value: unknown, size = 10, color = ink, weight = false, x = 48, w = width) => {
    for (const content of wrap(value, size, weight, w)) {
      if (y + size * 1.65 > bottom) newPage();
      drawText(content || " ", x, y, size, color, weight, { width: w }); y += size * 1.5;
    }
  };
  const space = (amount = 10) => { y += amount; if (y > bottom - 25) newPage(); };
  const rule = (x = 48, w = width) => { doc.moveTo(x, y).lineTo(x + w, y).strokeColor(line).lineWidth(0.6).stroke(); space(13); };
  const section = (index: string, title: string, subtitle: string, firstContent = 50) => {
    const needed = 25 + height(title, 20, true) + height(subtitle, 9) + firstContent;
    currentSection = title; ensure(needed); doc.outline.addItem(title); space(17); text(`${index} / ${title.toUpperCase()}`, 8, teal, true); space(5); text(title, 20, ink, true); space(7); text(subtitle, 9, muted); space(13);
  };
  const pill = (label: string, position: number, x = 48, good = false) => {
    doc.font("Bold").fontSize(7.5); const w = doc.widthOfString(plain(label)) + 14;
    doc.roundedRect(x, position, w, 16, 4).fill(good ? "#EAF6F1" : "#F1F5F8");
    drawText(label, x + 7, position + 3, 7.5, good ? teal : muted, true);
  };
  const summaryBox = (value: string) => {
    const boxH = height(value, 9, false, width - 28) + 26; ensure(boxH);
    doc.rect(48, y, width, boxH).fill("#F0F7F7");
    doc.rect(48, y, 3, boxH).fill(teal);
    const top = y; y += 13; text(value, 9, "#42616D", false, 62, width - 28); y = top + boxH + 16;
  };

  // Compact operational identity, followed by actual results rather than a marketing slogan.
  const title = data.reference.title || "Process session", titleH = height(title, 12);
  const titleInHero = titleH <= 150, heroH = titleInHero ? 170 + titleH : 156;
  doc.rect(0, 0, doc.page.width, heroH).fill(ink); doc.rect(0, heroH - 3, doc.page.width, 3).fill(teal);
  drawText("PROCESS GUIDE", 48, 37, 9, "#A4DBD9", true);
  drawText("DOCUMENTED SESSION / REVIEW REPORT", 48, 37, 8, "#B4C7D3", false, { width, align: "right" });
  y = 73; text("Session analysis", 28, "#FFFFFF", true); space(6);
  if (titleInHero) text(title, 12, "#DFEBEF");
  drawText(`GENERATED ${data.generated_at} / SNAPSHOT ${data.review_version}`, 48, heroH - 28, 8, "#B8CCD7", false);
  y = heroH + 24; doc.outline.addItem("Executive overview");
  if (!titleInHero) { text(title, 18, ink, true); space(18); }
  const s = stats(data), cardW = (width - 30) / 4;
  ensure(87);
  [[s.total ? `${s.complete}/${s.total}` : "No workflow", "Steps complete"], [s.exceptions, "Open exceptions"], [s.evidence, "Evidence records"], [s.totalChecks ? `${s.checks}/${s.totalChecks}` : "No checks", "Preparation checks"]].forEach(([value, label], index) => {
    const x = 48 + index * (cardW + 10);
    if (index > 0) doc.moveTo(x - 5, y + 8).lineTo(x - 5, y + 62).strokeColor(line).lineWidth(0.6).stroke();
    drawText(String(value), x + 12, y + 10, typeof value === "string" && value.startsWith("No ") ? 12 : 22, ink, true, { width: cardW - 24 });
    drawText(String(label), x + 12, y + 43, 8.5, muted, false, { width: cardW - 20 });
  }); y += 87;
  text("EXECUTIVE SUMMARY", 8, teal, true); space(5);
  const overview = `${s.total ? `${s.complete} of ${s.total} steps are complete at this snapshot.` : "No workflow has been extracted at this snapshot."} ${data.unresolved_criteria.length} criteria need review, and ${s.exceptions} exception(s) remain unresolved.`;
  text(overview, 10); space(7);
  const manual = data.progress.filter(step => step.complete && step.confirmation === "manual").length;
  const ai = data.progress.filter(step => step.complete && step.confirmation === "AI").length;
  text(`Completed steps: ${manual} manually confirmed / ${ai} AI-confirmed`, 9, muted);
  const derived = reportOverview(data), chartW = (width - 16) / 2;
  const charts = [
    { title: "Criterion observations", total: derived.criteriaTotal, groups: derived.criteriaGroups, note: "Recorded status includes operator confirmations and AI observations. This is not a quality score." },
    { title: "Evidence provenance", total: data.evidence.length, groups: derived.evidenceGroups, note: "Retained records do not establish continuous video coverage. Demo records are identified separately." },
  ];
  space(16); ensure(166); const chartsTop = y;
  charts.forEach((chart, index) => {
    const x = 48 + index * (chartW + 16), innerW = chartW - 28;
    doc.moveTo(x + 14, chartsTop + 150).lineTo(x + chartW - 14, chartsTop + 150).strokeColor(line).lineWidth(0.6).stroke();
    drawText(chart.title, x + 14, chartsTop + 14, 10, ink, true);
    drawText(`${chart.total} recorded`, x + 14, chartsTop + 34, 8, muted, false);
    let segmentX = x + 14; doc.rect(segmentX, chartsTop + 53, innerW, 6).fill("#EDF2F5");
    chart.groups.filter(group => group.count).forEach(group => { const segmentW = innerW * group.count / Math.max(1, chart.total); doc.rect(segmentX, chartsTop + 53, segmentW, 6).fill(group.color); segmentX += segmentW; });
    chart.groups.forEach((group, groupIndex) => { const col = groupIndex % 2, row = Math.floor(groupIndex / 2), gx = x + 14 + col * (innerW / 2 + 2), gy = chartsTop + 68 + row * 18; doc.rect(gx, gy + 2, 5, 5).fill(group.color); drawText(`${group.label} ${group.count}`, gx + 9, gy, 7, muted, false); });
    y = chartsTop + 110; text(chart.note, 7.5, muted, false, x + 14, innerW);
  }); y = chartsTop + 168;
  currentSection = "Recorded timeline";
  ensure(120); doc.outline.addItem("Recorded timeline");
  text("RECORDED MOMENTS", 8, teal, true); space(5);
  text("Evidence in time", 16, ink, true); space(7);
  text("Each mark represents retained evidence. Gaps are unobserved; demo and whole-video overview records are excluded.", 8.5, muted); space(14);
  if (derived.moments.length) {
    const laneTop = y, binWidth = (width - 39 * 3) / 40;
    for (const [index, bin] of derived.timeline.entries()) {
      const h = bin.count ? Math.min(28, 9 + bin.count * 4) : 2;
      doc.rect(48 + index * (binWidth + 3), laneTop + 28 - h, binWidth, h)
        .fill(!bin.count ? line : bin.status === "alert" ? "#B9614B" : bin.status === "watch" ? "#B68B46" : teal);
    }
    y += 37;
    drawText("00:00", 48, y, 8, muted, false);
    drawText(`${clock(derived.lastMoment)} / last retained moment`, 48, y, 8, muted, false, { width, align: "right" });
    space(20);
    text(`${derived.moments.length} real, source-scoped moments / Recorded (teal), watch (ochre), alert (rust)`, 8, muted); space(14);
  } else { text("No real moments have been retained for this source.", 9, muted); space(14); }
  currentSection = "Review priorities";
  ensure(105); doc.outline.addItem("Review priorities"); text("FOLLOW-THROUGH", 8, teal, true); space(5); text("Review priorities", 18, ink, true); space(7);
  text("First listed item per category, with exact remaining counts. Full records follow in the detailed sections.", 9, muted); space(12);
  if (!derived.priorities.length) { text("No follow-up items are listed in this snapshot. This is not a certification of process quality or safety.", 9, muted); space(12); }
  for (const [index, item] of derived.priorities.entries()) {
    const cardH = 40 + height(item.title, 10, true, width - 62) + height(item.detail, 9, false, width - 62);
    if (cardH <= bottom - 90) {
      ensure(cardH + 10);
      doc.moveTo(48, y + cardH).lineTo(48 + width, y + cardH).strokeColor(line).lineWidth(0.6).stroke();
    }
    const top = y; drawText(String(index + 1).padStart(2, "0"), 62, top + 15, 8, teal, true); y += 13;
    text(`${item.kind.toUpperCase()} / ${item.count} remaining`, 8, muted, true, 86, width - 62); space(4);
    text(item.title, 10, ink, true, 86, width - 62); space(4); text(item.detail, 9, muted, false, 86, width - 62); space(15);
    if (cardH <= bottom - 90) y = top + cardH + 10;
  }
  space(8); summaryBox(scopeNotice);
  currentSection = "Session context"; ensure(105); doc.outline.addItem("Session context"); text("SESSION CONTEXT", 8, teal, true); space(12);
  const metadata = [
    ["Workflow", data.reference.title || "Not recorded"], ["Source", `${data.source.name || "Unnamed input"} (${data.source.kind})`],
    ["Guidance reference", data.reference.filename || (data.reference.workflow_source === "none" ? "No guidance document - workflow not extracted" : "No guidance document - inferred workflow")], ["Snapshot position", `${clock(data.source.current_time_s)}${data.source.duration_s !== null ? ` / ${clock(data.source.duration_s)}` : " (live source)"}`],
    ["Work order", data.job.work_order || "Not recorded"], ["Asset", data.job.asset || "Not recorded"], ["Operator", data.job.operator || "Not recorded"],
  ];
  const colWidth = (width - 26) / 2;
  for (let index = 0; index < metadata.length; index += 2) {
    const pair = metadata.slice(index, index + 2), rowH = Math.max(...pair.map(([, value]) => height(value, 10, false, colWidth))) + 29;
    if (rowH > bottom - 100) { for (const [label, value] of pair) { text(label.toUpperCase(), 8, muted, true); space(3); text(value); space(12); } continue; }
    ensure(rowH); const top = y;
    pair.forEach(([label, value], col) => { y = top; const x = 48 + col * (colWidth + 26); text(label.toUpperCase(), 8, muted, true, x, colWidth); space(3); text(value, 10, ink, false, x, colWidth); });
    y = top + rowH;
  }
  if (data.operator_goals) { ensure(45); text("OPERATOR FOCUS", 8, teal, true); space(5); text(data.operator_goals, 10, muted); }

  const criterionHeight = (criterion: StructuredHandoff["progress"][number]["criteria"][number]) => height(criterion.label, 10, true, width - 88) + (criterion.confirmed_at_s !== null ? 16 : 0) + (criterion.evidence ? height(criterion.evidence, 9.5, false, width - 88) + 4 : 0) + 35;
  const stepOpeningHeight = (step: StructuredHandoff["progress"][number]) => height(step.name, 12, true, width - 39) + 48
    + (step.objective ? height(step.objective, 10) + 10 : 0)
    + (step.description && step.description !== step.objective ? height(step.description, 10) + 10 : 0)
    + (step.actions.length ? 23 + step.actions.reduce((sum, action, index) => sum + height(`${index + 1}. ${action}`, 9) + 4, 0) : 0)
    + (step.expected_instruments.length ? height(step.expected_instruments.join(" / "), 9) + 27 : 0)
    + (step.criteria[0] ? criterionHeight(step.criteria[0]) : 0);
  section("01", "Workflow progress", `${data.unresolved_criteria.length} criteria need review. Progress reflects this snapshot; each step carries its confirmation origin.`, data.progress[0] ? Math.min(400, stepOpeningHeight(data.progress[0])) : 50);
  if (!data.progress.length) text("No workflow steps have been extracted yet.", 10, muted);
  data.progress.forEach((step, index) => {
    ensure(stepOpeningHeight(step));
    const top = y; doc.roundedRect(48, top, 27, 27, 6).fill("#EBF5F5"); drawText(String(index + 1).padStart(2, "0"), 54, top + 7, 9, teal, true);
    y += 2; text(step.name, 12, ink, true, 87, width - 39); space(5);
    text(`${step.complete ? "Complete" : "In progress"} / ${step.progress}% recorded progress / ${step.confirmation === "manual" ? "Manually confirmed" : step.confirmation === "AI" ? "AI-confirmed criteria" : "Unconfirmed"}`, 8.5, teal, false, 87, width - 39);
    space(8); doc.rect(48, y, width, 2).fill("#EDF2F5"); const pct = Number.isFinite(step.progress) ? Math.max(0, Math.min(100, step.progress)) : 0; if (pct) doc.rect(48, y, width * pct / 100, 2).fill(teal); space(13);
    if (step.objective) { text(step.objective, 10, muted); space(10); }
    if (step.description && step.description !== step.objective) { text(step.description, 10, muted); space(10); }
    if (step.actions.length) { ensure(45); text("PLANNED ACTIONS", 8, teal, true); space(5); for (const [actionIndex, action] of step.actions.entries()) { text(`${actionIndex + 1}. ${action}`, 9, muted); space(4); } space(6); }
    if (step.expected_instruments.length) { ensure(40); text("EXPECTED INSTRUMENTS", 8, teal, true); space(5); text(step.expected_instruments.join(" / "), 9, muted); space(10); }
    for (const criterion of step.criteria) {
      ensure(criterionHeight(criterion)); const rowTop = y; pill(criterion.status.replace(/_/g, " ").toUpperCase(), rowTop + 1, 48, criterion.status === "met");
      text(criterion.label, 10, ink, true, 136, width - 88);
      if (criterion.confirmed_at_s !== null) { space(3); text(`Recorded at ${clock(criterion.confirmed_at_s)}`, 8.5, teal, false, 136, width - 88); }
      if (criterion.evidence) { space(4); text(criterion.evidence, 9.5, muted, false, 136, width - 88); }
      y = Math.max(y, rowTop + 22); space(10); rule(136, width - 88);
    }
    space(12);
  });

  section("02", "Exceptions", `${s.exceptions} unresolved exception(s). Resolving an issue does not confirm workflow criteria.`);
  if (!data.exception_history.length) text("No exceptions were recorded. This does not establish that the process was free of issues.", 10, muted);
  for (const issue of data.exception_history) {
    ensure(height(issue.title, 12, true) + 46);
    pill(issue.status.toUpperCase(), y, 48, issue.status === "resolved"); space(25);
    text(issue.title, 12, ink, true); text(`${provenance(issue.provenance)}${issue.old_reference ? " / Earlier reference" : ""}`, 8.5, muted);
    if (issue.description !== issue.title) { space(7); text(issue.description, 10, muted); }
    for (const item of issue.history) {
      space(13); ensure(height(`${item.status.toUpperCase()} / ${iso(item.at)}`, 8.5, true, width - 17) + height(item.note || "No note recorded", 10, false, width - 17) + height(item.operator || "Operator", 8.5, false, width - 17) + 12); doc.circle(51, y + 5, 2.5).fill(teal);
      text(`${item.status.toUpperCase()} / ${iso(item.at)}`, 8.5, teal, true, 65, width - 17);
      space(4); text(item.note || "No note recorded", 10, ink, false, 65, width - 17);
      space(3); text(item.operator || "Operator", 8.5, muted, false, 65, width - 17);
    }
    if (issue.history_omitted) { space(8); text(`${issue.history_omitted} older decision(s) omitted by the history retention limit.`, 9, muted); }
    space(17); rule();
  }

  const evidenceItems = (event: StructuredHandoff["evidence"][number]) => [
    { value: `${clock(event.video_time_s)} / ${event.kind}`, size: 8.5, color: teal, bold: true },
    { value: event.summary || "Evidence record", size: 11, color: ink, bold: true },
    { value: `${provenance(event.provenance, event.simulated)} / ${event.status}${event.old_reference ? " / Earlier reference" : ""}`, size: 8.5, color: muted, bold: false },
    ...(event.guidance ? [{ value: event.guidance, size: 10, color: ink, bold: false }] : []),
    ...(event.concern ? [{ value: `Concern: ${event.concern}`, size: 10, color: "#805A24", bold: false }] : []),
    { value: `${iso(event.occurred_at)}${event.operator ? ` / ${event.operator}` : ""}${event.model ? ` / ${event.model}` : ""}${event.observation_scope === "overview" ? " / Whole-video overview" : ""}`, size: 8.5, color: muted, bold: false },
  ];
  const cardHeight = (event: StructuredHandoff["evidence"][number], w: number) => evidenceItems(event).reduce((sum, item) => sum + height(item.value, item.size, item.bold, w) + 7, 0) + 25;
  const first = data.evidence[0];
  section("03", "Recorded evidence", "AI observations, system checks and operator bookmarks are labeled separately. Earlier-reference records retain their original context.", first ? Math.min(350, cardHeight(first, thumbnail(first.thumbnail_b64) ? width - 228 : width - 28)) : 30);
  const findings = guardianReportFindings(data);
  ensure(90); text(`Guardian findings / ${findings.length} retained`, 12, ink, true); space(6);
  text("Non-demo AI and system concerns. Suggested windows use 6 seconds before and 3 seconds after the recorded moment. Footage is prepared separately in the app; this report contains a static index and recorded evidence.", 9, muted); space(13);
  if (!findings.length) { text("No qualifying Guardian concerns were retained. This does not establish that the process was free of issues.", 9, muted); space(12); }
  for (const [index, { event, window, decisions }] of findings.entries()) {
    const title = event.concern || event.summary || "Recorded concern";
    ensure(height(title, 10, true) + 65);
    text(`${String(index + 1).padStart(2, "0")} / ${clock(event.video_time_s)} / ${event.status.toUpperCase()} / ${provenance(event.provenance)}${event.old_reference ? " / Earlier reference" : ""}`, 8, teal, true); space(4);
    text(title, 10, ink, true); space(5);
    text(window ? `Suggested video window ${clock(window.start_s)} - ${clock(window.end_s)}` : "Recorded sample only - no playable video window", 8.5, muted); space(5);
    if (!decisions.length) text("No linked exception decision was recorded.", 8.5, muted);
    for (const issue of decisions) { text(`Decision: ${issue.status} / ${issue.history.at(-1)?.note || "No decision note recorded"}`, 9, muted); space(4); }
    space(10); rule();
  }
  if (!data.evidence.length) text("No evidence records were retained for this source.", 10, muted);
  data.evidence.forEach((event, index) => {
    const image = thumbnail(event.thumbnail_b64), copyW = image ? width - 228 : width - 28;
    const cardH = Math.max(image ? 162 : 0, cardHeight(event, copyW));
    if (cardH <= bottom - 90) {
      ensure(cardH + 14); const top = y;
      doc.roundedRect(48, top, width, cardH, 8).fillAndStroke("#FCFDFE", line);
      if (image) {
        try { doc.image(image, 62, top + 14, { fit: [186, 128] }); } catch { drawText("Image unavailable", 62, top + 17, 9, muted, false); }
        drawText(`FRAME ${String(index + 1).padStart(2, "0")} / ${clock(event.video_time_s)}`, 62, top + 142, 8, muted, true);
      }
      y = top + 13;
      for (const item of evidenceItems(event)) { text(item.value, item.size, item.color, item.bold, image ? 262 : 62, copyW); space(7); }
      y = top + cardH + 14;
    } else {
      ensure(75); text(`${clock(event.video_time_s)} / ${event.kind}`, 8.5, teal, true);
      if (image) { ensure(155); space(6); try { doc.image(image, 48, y, { fit: [width, 140] }); y += 149; } catch { text("Evidence image could not be rendered.", 9, muted); } }
      for (const item of evidenceItems(event).slice(1)) { text(item.value, item.size, item.color, item.bold); space(7); }
      space(7); rule();
    }
  });

  section("04", "Operator preparation", "Suggested workflow tools and principles. These are manual preparation checks.");
  if (!data.operator_checks.length) text("No preparation checks were derived from this workflow.", 10, muted);
  for (const check of data.operator_checks) {
    ensure(55); text(`${check.checked ? "Checked" : "Not checked"} / ${check.label}`, 10, ink, true);
    text(`${check.kind}${check.checked_at ? ` / ${iso(check.checked_at)}` : ""}${check.checked_by ? ` / ${check.checked_by}` : ""}`, 8.5, muted); space(12);
  }
  section("05", "Reference scope", "Recorded workflow principles and extraction notes, not new findings from this report.");
  text(`Workflow origin: ${data.reference.workflow_source}`, 10, muted); space(13);
  text("PRINCIPLES", 8, teal, true); space(6);
  if (!data.reference.principles.length) text("No workflow principles were recorded.", 9, muted);
  for (const [index, principle] of data.reference.principles.entries()) { text(`${index + 1}. ${principle}`, 10); space(7); }
  space(10); text("EXTRACTION NOTES", 8, teal, true); space(6);
  if (!data.reference.warnings.length) text("No extraction notes were recorded.", 9, muted);
  for (const note of data.reference.warnings) { text(note, 9, muted); space(7); }
  section("06", "Snapshot context", data.notice);
  text(`Retained ${data.retention.retained_events} events and ${data.retention.retained_thumbnails} thumbnails. Omitted by retention limits: ${data.retention.dropped_events} events, ${data.retention.dropped_thumbnails} thumbnails, ${data.retention.dropped_exceptions} exceptions.`, 9, muted);
  space(12); text(`Source: ${data.source.id}`, 8, muted); text(`Reference digest: ${data.reference.reference_key}`, 8, muted);
  text(`Schema ${data.schema_version} / Review snapshot ${data.review_version} / Progress revision ${data.session_revision} / Preferences revision ${data.preferences_revision} / ${data.generated_at}`, 8, muted);
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index); const previousBottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    const footerY = doc.page.height - 40;
    doc.moveTo(48, footerY - 10).lineTo(48 + width, footerY - 10).strokeColor(line).lineWidth(0.6).stroke();
    drawText(`PROCESS GUIDE / Sampled evidence / Snapshot ${data.review_version}`, 48, footerY, 7.5, muted, false);
    drawText(`${index + 1} / ${range.count}`, 48, footerY, 7.5, muted, false, { width, align: "right" }); doc.page.margins.bottom = previousBottom;
  }
  doc.end(); return output;
}
