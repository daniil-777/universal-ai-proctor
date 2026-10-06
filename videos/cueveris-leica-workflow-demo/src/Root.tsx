import {Composition, staticFile} from 'remotion';
import {LeicaStudyFilm} from './LeicaStudyFilm';
import {DemoData, timeline, validateData} from './data';

export const Root = () => (
  <Composition
    id="CueverisLeicaStudy"
    component={LeicaStudyFilm}
    durationInFrames={1890}
    fps={30}
    width={1440}
    height={900}
    defaultProps={{data: null as DemoData | null}}
    calculateMetadata={async () => {
      const response = await fetch(staticFile('demo-data.json'));
      if (!response.ok) throw new Error('Missing genuine Leica study captures and demo-data.json.');
      const data = validateData(await response.json());
      const scenes = timeline(data);
      const last = scenes[scenes.length-1];
      return {durationInFrames: last.start+last.duration, props: {data}};
    }}
  />
);
