export const UNSUPPORTED_REPORT_CHARACTERS = "unsupported_report_characters";
export const UNSUPPORTED_REPORT_MESSAGE = "This report contains characters the PDF font cannot render. Download the offline HTML report to preserve all text.";
export function unsupportedReportCharacters() {
  return Object.assign(new Error(UNSUPPORTED_REPORT_MESSAGE), { code: UNSUPPORTED_REPORT_CHARACTERS, statusCode: 422 });
}
