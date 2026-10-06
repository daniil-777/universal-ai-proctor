import React from 'react';
import {loadFont} from '@remotion/fonts';
import {Audio} from '@remotion/media';
import {AbsoluteFill, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {DemoData, QuestionCheckpoint, timeline} from './data';

loadFont({family: 'Inter', url: staticFile('inter.ttf')});

const ink = '#0a1c2a';
const teal = '#8ed9d9';
const white = '#f6f9fc';
const secondary = '#b6c8d4';
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const reveal = (frame: number, delay = 0) => interpolate(frame, [delay, delay+24], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});

const Brand = ({light = false}: {light?: boolean}) => (
  <div style={{position: 'absolute', top: 43, left: 62, display: 'flex', alignItems: 'center', gap: 13, color: light ? ink : white}}>
    <svg width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="33" height="33" rx="9" stroke={light ? '#0b7d8a' : teal} strokeWidth="2" />
      <path d="M24 11H16a6.5 6.5 0 0 0 0 13h8M16 17.5h8" stroke={light ? '#0b7d8a' : teal} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
    <span style={{fontSize: 27, fontWeight: 650, letterSpacing: '-.045em'}}>Cueveris</span>
  </div>
);

const Frame = ({children, opening = false, light = false}: {children: React.ReactNode; opening?: boolean; light?: boolean}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = opening ? 1 : interpolate(frame, [0, .5*fps], [0, 1], clamp);
  return (
    <AbsoluteFill style={{opacity, background: light ? '#e8f0f4' : ink}}>
      <Brand light={light} />
      <div style={{position: 'absolute', top: 54, right: 62, fontSize: 17, letterSpacing: '.08em', color: light ? '#526b7b' : secondary}}>LEICA M10 STUDY · REFERENCE-ONLY TEXT Q&A</div>
      {children}
    </AbsoluteFill>
  );
};

const Heading = ({kicker, title, light = false}: {kicker: string; title: string; light?: boolean}) => {
  const frame = useCurrentFrame();
  const p = reveal(frame, 7);
  return <div style={{position: 'absolute', left: 62, top: 114, opacity: p, transform: `translateY(${(1-p)*13}px)`}}>
    <div style={{fontSize: 20, fontWeight: 650, color: light ? '#087b88' : teal, letterSpacing: '.1em', marginBottom: 16}}>{kicker}</div>
    <div style={{fontSize: 58, fontWeight: 600, letterSpacing: '-.055em', lineHeight: 1.08, color: light ? ink : white}}>{title}</div>
  </div>;
};

const Surface = ({children, style = {}}: {children: React.ReactNode; style?: React.CSSProperties}) => <div style={{border: '1px solid rgba(145,190,208,.3)', borderRadius: 17, overflow: 'hidden', boxShadow: '0 25px 65px rgba(0,0,0,.2)', ...style}}>{children}</div>;

const SourceCard = ({style = {}, compact = false}: {style?: React.CSSProperties; compact?: boolean}) => (
  <Surface style={{padding: compact ? '22px 24px' : '31px 29px', background: '#102837', ...style}}>
    <div style={{fontSize: compact ? 15 : 17, fontWeight: 600, color: teal, letterSpacing: '.09em', marginBottom: compact ? 13 : 26}}>OFFICIAL FILM · SEPARATE PLAYER</div>
    {!compact && <svg width="54" height="46" viewBox="0 0 54 46" fill="none" aria-hidden="true">
      <rect x="1" y="6" width="52" height="34" rx="7" stroke="#7898ad" strokeWidth="2" />
      <path d="M23 15L35 23L23 31V15Z" stroke={teal} strokeWidth="2" strokeLinejoin="round" />
    </svg>}
    <div style={{fontSize: compact ? 24 : 29, lineHeight: 1.25, letterSpacing: '-.035em', color: white, marginTop: compact ? 0 : 22}}>Watch the official Leica film beside this walkthrough.</div>
    {!compact && <div style={{fontSize: 18, lineHeight: 1.4, color: secondary, marginTop: 20}}>Leica Camera · official YouTube player</div>}
  </Surface>
);

const Opening = ({data}: {data: DemoData}) => {
  const frame = useCurrentFrame();
  const p = reveal(frame, 9);
  return <Frame opening>
    <div style={{position: 'absolute', top: 238, left: 62, width: 660, opacity: p, transform: `translateY(${(1-p)*16}px)`}}>
      <div style={{fontSize: 23, fontWeight: 600, color: teal, letterSpacing: '.1em', marginBottom: 24}}>AN INDEPENDENT GUIDED FILM STUDY</div>
      <div style={{fontSize: 82, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-.065em'}}>Leica M10.</div>
      <div style={{fontSize: 67, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.055em', color: teal, marginTop: 14}}>Ask the guide.<br />Hear the next check.</div>
      <div style={{fontSize: 28, lineHeight: 1.35, color: secondary, marginTop: 31}}>Six guide checkpoints.<br />Real app questions and spoken answers.</div>
    </div>
    <Surface style={{position: 'absolute', left: 770, top: 222, width: 608, height: 491, background: '#f3f6f8', opacity: p}}>
      <Img src={staticFile(data.guide_panel_file)} style={{width: '100%', height: '100%', objectFit: 'contain'}} />
    </Surface>
    <div style={{position: 'absolute', left: 62, bottom: 47, fontSize: 24, color: secondary}}>Reference question + guide → app answer → app-generated voice</div>
    <div style={{position: 'absolute', right: 62, bottom: 50, fontSize: 17, color: teal}}>ACTUAL RECORDED UI · NO FILM IMAGE INPUT</div>
  </Frame>;
};

const Setup = ({data}: {data: DemoData}) => {
  const frame = useCurrentFrame();
  const p = reveal(frame, 11);
  return <Frame>
    <Heading kicker="01 / LOAD THE GUIDE" title="Watch the film. Ask the guide." />
    <SourceCard style={{position: 'absolute', left: 62, top: 270, width: 401, height: 391, boxSizing: 'border-box', opacity: p}} />
    <Surface style={{position: 'absolute', left: 506, top: 259, width: 872, height: 466, background: '#f3f6f8', opacity: p}}>
      <Img src={staticFile(data.setup_panel_file)} style={{width: '100%', height: '100%', objectFit: 'contain'}} />
    </Surface>
    <div style={{position: 'absolute', left: 62, right: 62, bottom: 48, fontSize: 27, lineHeight: 1.35, color: secondary}}>The six checkpoints guide questions. Hidden checks stay unknown.</div>
  </Frame>;
};

const Question = ({question, number}: {question: QuestionCheckpoint; number: number}) => {
  const frame = useCurrentFrame();
  const p = reveal(frame, 12);
  const wordCount = question.answer.split(/\s+/).length;
  const quoteFont = wordCount > 65 ? 25 : wordCount > 43 ? 29 : 33;
  const spokenStart = question.answer.indexOf(question.spoken_text);
  const before = question.answer.slice(0, spokenStart);
  const after = question.answer.slice(spokenStart+question.spoken_text.length);
  return <Frame>
    <Heading kicker={`0${number+1} / REFERENCE QUESTION + GUIDE`} title={question.title} />
    <div style={{position: 'absolute', left: 62, top: 269, width: 415, opacity: p}}>
      <div style={{fontSize: 18, color: teal, letterSpacing: '.1em', fontWeight: 600, marginBottom: 16}}>REFERENCE TOPIC</div>
      <div style={{fontSize: 29, lineHeight: 1.33, letterSpacing: '-.035em', color: white}}>“{question.reference_topic}”</div>
      <div style={{fontSize: 19, color: secondary, marginTop: 20, lineHeight: 1.4}}>Question: {question.question}</div>
      <div style={{height: 2, width: 54, background: teal, margin: '24px 0 21px'}} />
      <div style={{fontSize: 23, color: secondary, lineHeight: 1.4}}>The answer uses text context and the loaded guide.</div>
    </div>
    <Surface style={{position: 'absolute', left: 525, top: 255, width: 853, height: 274, background: '#eef4f8', opacity: p}}>
      <Img src={staticFile(question.app_panel_file)} style={{width: '100%', height: '100%', objectFit: 'contain'}} />
    </Surface>
    <SourceCard compact style={{position: 'absolute', left: 62, top: 648, width: 415, height: 158, boxSizing: 'border-box', opacity: p}} />
    <div style={{position: 'absolute', left: 525, top: 557, width: 853, opacity: p}}>
      <div style={{fontSize: 17, color: teal, fontWeight: 600, letterSpacing: '.08em', marginBottom: 15}}>{question.spoken_excerpt ? 'ACTUAL APP ANSWER · SPOKEN EXCERPT HIGHLIGHTED' : 'ACTUAL APP ANSWER · APP-GENERATED VOICE'}</div>
      <div style={{fontSize: quoteFont, lineHeight: 1.27, letterSpacing: '-.032em', color: secondary}}>“{before}<span style={{color: white, fontWeight: 550}}>{question.spoken_text}</span>{after}”</div>
    </div>
    <div style={{position: 'absolute', left: 62, bottom: 37, fontSize: 21, color: secondary}}>Reference-only text answer · no visual analysis · checks remain unconfirmed</div>
    <Sequence from={30} durationInFrames={Math.ceil(question.voice_duration_seconds*30)} premountFor={30}>
      <Audio src={staticFile(question.voice_file)} />
    </Sequence>
  </Frame>;
};

const Review = ({data}: {data: DemoData}) => {
  const frame = useCurrentFrame();
  const p = reveal(frame, 10);
  return <Frame light>
    <Heading kicker="05 / REVIEW THE GUIDE" title="Keep hidden checks unknown." light />
    <div style={{position: 'absolute', left: 62, top: 273, width: 799, opacity: p}}>
      <div style={{fontSize: 18, letterSpacing: '.1em', fontWeight: 650, color: '#087b88', marginBottom: 24}}>SIX ORIGINAL OBSERVATION CHECKPOINTS</div>
      {data.guide_titles.map((title, index) => <div key={title} style={{display: 'flex', gap: 18, alignItems: 'center', marginBottom: 27, color: ink}}>
        <span style={{fontSize: 20, fontWeight: 550, color: '#087b88', width: 32}}>{String(index+1).padStart(2, '0')}</span>
        <span style={{fontSize: 27, letterSpacing: '-.035em', lineHeight: 1.25}}>{title}</span>
      </div>)}
    </div>
    <Surface style={{position: 'absolute', left: 902, top: 249, width: 476, height: 468, background: white, border: '1px solid #ccdbe3', opacity: p, boxShadow: '0 24px 65px rgba(10,28,42,.13)'}}>
      <Img src={staticFile(data.review_panel_file)} style={{width: '100%', height: '100%', objectFit: 'contain'}} />
    </Surface>
    <div style={{position: 'absolute', left: 62, right: 62, top: 758, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: ink, opacity: p}}>
      <div style={{fontSize: 31, fontWeight: 550, letterSpacing: '-.04em'}}><span style={{color: '#087b88'}}>{data.report.text_questions}</span> text questions</div>
      <div style={{width: 1, height: 39, background: '#bccfd9'}} />
      <div style={{fontSize: 31, fontWeight: 550, letterSpacing: '-.04em'}}><span style={{color: '#087b88'}}>{data.report.visual_analyses}</span> visual analyses</div>
      <div style={{width: 1, height: 39, background: '#bccfd9'}} />
      <div style={{fontSize: 31, fontWeight: 550, letterSpacing: '-.04em'}}><span style={{color: '#087b88'}}>{data.report.confirmed_steps}/{data.report.total_steps}</span> steps confirmed</div>
    </div>
    <div style={{position: 'absolute', left: 62, bottom: 34, fontSize: 20, color: '#526b7b'}}>Text answers support review. Hidden tolerances and acceptance checks remain unverified.</div>
  </Frame>;
};

const Closing = () => {
  const frame = useCurrentFrame();
  const p = reveal(frame, 5);
  return <Frame>
    <div style={{position: 'absolute', left: 62, top: 302, opacity: p, transform: `translateY(${(1-p)*13}px)`}}>
      <div style={{fontSize: 77, fontWeight: 600, letterSpacing: '-.06em', lineHeight: 1.08}}>Watch. Ask. Review.</div>
      <div style={{fontSize: 32, color: teal, marginTop: 24}}>Cueveris · a Leica M10 guided film study</div>
      <div style={{fontSize: 27, color: secondary, marginTop: 37}}>Document-based Q&A · reference guidance · 0/6 steps confirmed</div>
      <div style={{fontSize: 23, color: secondary, marginTop: 21}}>The official Leica film plays separately on the webpage.</div>
    </div>
    <div style={{position: 'absolute', left: 62, right: 62, bottom: 52, color: secondary, fontSize: 19, lineHeight: 1.5}}>
      <div>Original Cueveris guide and UI · genuine app-generated answers and speech</div>
      <div style={{fontSize: 17, color: '#98aebb'}}>Independent study · no Leica endorsement · no Leica footage or source audio incorporated</div>
    </div>
  </Frame>;
};

export const LeicaStudyFilm = ({data}: {data: DemoData | null}) => {
  const {fps} = useVideoConfig();
  if (!data) throw new Error('Genuine capture metadata must be loaded before rendering.');
  const scenes = timeline(data, fps);
  return <AbsoluteFill style={{fontFamily: 'Inter', color: white, background: ink}}>
    {scenes.map(scene => <Sequence key={scene.key} from={scene.start} durationInFrames={scene.duration} premountFor={fps}>
      {scene.key === 'opening' ? <Opening data={data} /> : scene.key === 'setup' ? <Setup data={data} /> : scene.key === 'review' ? <Review data={data} /> : scene.key === 'closing' ? <Closing /> : scene.question ? <Question question={scene.question} number={data.questions.findIndex(q => q.key === scene.key)+1} /> : null}
    </Sequence>)}
  </AbsoluteFill>;
};
