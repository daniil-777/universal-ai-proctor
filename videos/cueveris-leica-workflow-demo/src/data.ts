export type QuestionCheckpoint = {
  key: string;
  title: string;
  reference_topic: string;
  question: string;
  answer: string;
  spoken_text: string;
  spoken_excerpt: boolean;
  voice_file: string;
  voice_duration_seconds: number;
  app_panel_file: string;
  guide_stage_label?: string;
};

export type DemoData = {
  title: string;
  recorded_at: string;
  guide_filename: string;
  guide_digest: string;
  guide_panel_file: string;
  setup_panel_file: string;
  review_panel_file: string;
  guide_titles: string[];
  protocol: {
    mode: 'document_based_text_questions';
    frames_submitted: 0;
    simulated: false;
    source_film_downloaded: false;
  };
  questions: QuestionCheckpoint[];
  report: {
    text_questions: number;
    visual_analyses: number;
    confirmed_steps: number;
    total_steps: number;
    title: string;
  };
};

export type SceneTiming = {key: string; start: number; duration: number; question?: QuestionCheckpoint};

export const validateData = (data: DemoData) => {
  if (data.protocol?.mode !== 'document_based_text_questions' || data.protocol.frames_submitted !== 0 || data.protocol.simulated !== false || data.protocol.source_film_downloaded !== false) {
    throw new Error('This composition requires genuine text-only app questions, zero image frames and no source-film download.');
  }
  if (data.questions?.length !== 3) throw new Error('Three genuine recorded Q&A checkpoints are required.');
  if (data.guide_titles?.length !== 6) throw new Error('The actual six guide titles are required.');
  for (const q of data.questions) {
    if (!q.question || !q.answer || !q.spoken_text || !q.app_panel_file || !q.voice_file || !(q.voice_duration_seconds > 0)) throw new Error('Each checkpoint needs the actual question, full answer, spoken answer, UI capture and voice duration.');
    if (!q.answer.includes(q.spoken_text)) throw new Error('Each spoken excerpt must occur verbatim in its actual answer.');
    if (/https?:|youtube|leica.*\.(?:mp4|webm)/i.test(q.voice_file)) throw new Error('Only packaged app-generated voice audio is permitted.');
  }
  if (data.report.visual_analyses !== 0 || data.report.confirmed_steps !== 0 || data.report.total_steps !== 6) throw new Error('The study must retain six unconfirmed steps and zero visual analyses.');
  return data;
};

export const timeline = (data: DemoData, fps = 30): SceneTiming[] => {
  const seconds = [
    {key: 'opening', duration: 6},
    {key: 'setup', duration: 7},
    ...data.questions.map(question => ({key: question.key, duration: Math.max(14, question.voice_duration_seconds + 2.25), question})),
    {key: 'review', duration: 7},
    {key: 'closing', duration: 4},
  ];
  let start = 0;
  return seconds.map((scene, index) => {
    const duration = Math.ceil(scene.duration*fps);
    const result = {...scene, start, duration};
    start += duration - (index < seconds.length-1 ? Math.round(.5*fps) : 0);
    return result;
  });
};
