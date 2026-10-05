import type {SampleVideoDefinition} from './sampleVideo.js';

// Verified bundled sources; source URLs are attribution only, never runtime fetches.
export const REAL_SCENARIO_SAMPLES: readonly SampleVideoDefinition[] = [
  {
    "id": "real-house-construction",
    "name": "House construction — SIP assembly",
    "filename": "real-01-house.mp4",
    "guidance": "Real_01_House_Construction.txt",
    "description": "Real two-storey house assembly: panel preparation, wall enclosure, upper storey and roof work. The source includes timelapse and edited close-ups.",
    "default": false,
    "duration_s": 180,
    "bytes": 99506681,
    "source_url": "https://commons.wikimedia.org/wiki/File:Structural_insulated_panel_house_construction_in_7_minutes_-_%D0%AD%D0%BA%D0%BE_%D0%A1%D0%B8%D1%82%D0%B8_-_Russia.webm",
    "author": "Эко Сити (Eco-City)",
    "license": "CC BY 3.0",
    "license_url": "https://creativecommons.org/licenses/by/3.0/",
    "excerpt": {
      "start_s": 80,
      "end_s": 260,
      "source_duration_s": 400.141,
      "description": "Original timelapse and shot timing retained."
    },
    "changes": "Contiguous 01:20–04:20 source excerpt, H.264/AAC conversion; native 1920×1080 preserved."
  },
  {
    "id": "real-manufacturing",
    "name": "Manufacturing — tool and mould production",
    "filename": "real-02-manufacturing.mp4",
    "guidance": "Real_02_Manufacturing.txt",
    "description": "Real workshop film showing controller interaction, machining, tooling, visible measuring equipment and drawing review. This montage does not track one continuous production job.",
    "default": false,
    "duration_s": 175.124921,
    "bytes": 86059091,
    "source_url": "https://commons.wikimedia.org/wiki/File:SCHMELZER_FORMENTECHNIK_Waldershof_Fichtelgebirge_Imagefilm.webm",
    "author": "handysheriff",
    "license": "CC BY 3.0",
    "license_url": "https://creativecommons.org/licenses/by/3.0/",
    "changes": "Full source film converted to H.264/AAC; native 1920×1080, original montage timing and shot order preserved."
  },
  {
    "id": "real-surgery",
    "name": "Surgery — published laparoscopic footage",
    "filename": "real-03-surgery.mp4",
    "guidance": "Real_03_Surgery.txt",
    "description": "Published operative footage with introductory imaging, visible instrument/thread handling, later material and tube views, and a final image. Educational observation of graphic surgical footage.",
    "default": false,
    "duration_s": 180,
    "bytes": 14724822,
    "source_url": "https://commons.wikimedia.org/wiki/File:Laparoscopic-treatment-of-biliary-peritonitis-following-nonoperative-management-of-blunt-liver-1749-7922-5-26-S1.ogv",
    "author": "Marzano E, Rosso E, Oussoultzoglou E, Collange O, Bachellier P, Pessaux P",
    "license": "CC BY 2.0",
    "license_url": "https://creativecommons.org/licenses/by/2.0/",
    "excerpt": {
      "start_s": 0,
      "end_s": 180,
      "source_duration_s": 180.687528,
      "description": "Final 0.688 seconds omitted."
    },
    "changes": "First 180 seconds converted to H.264/AAC; native 480×272, aspect ratio and source speed preserved."
  },
  {
    "id": "real-dancing",
    "name": "Dancing — tap footwork",
    "filename": "real-04-dancing.mp4",
    "guidance": "Real_04_Dancing.txt",
    "description": "Real edited tap-footwork demonstrations: visible lifts, forward/backward shoe movements, floor contact and wider leg views. Upper-body movement is largely outside the frame.",
    "default": false,
    "duration_s": 123.415533,
    "bytes": 5434324,
    "source_url": "https://commons.wikimedia.org/wiki/File:Tap_Dance_Technique.webm",
    "author": "Dbuetow",
    "license": "CC BY-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
    "changes": "Full actual packet timeline converted to H.264/AAC; native 428×240 and all source frames retained. Source container tag says 124.393 seconds; playable source ends near 123.416 seconds. Adaptation retains CC BY-SA 4.0."
  },
  {
    "id": "real-sport",
    "name": "Sport — EZ and straight-bar curls",
    "filename": "real-05-sport.mp4",
    "guidance": "Real_05_Sport.txt",
    "description": "Real exercise technique presentation comparing visible EZ-bar and straight-bar curl demonstrations and explanatory scenes. Observe displayed movement without prescribing loads or diagnosing technique.",
    "default": false,
    "duration_s": 173.221875,
    "bytes": 113075870,
    "source_url": "https://commons.wikimedia.org/wiki/File:Video_of_EZ_Bar_Curl_and_Straight_Bar_Curl.webm",
    "author": "Colossus Fitness",
    "license": "CC BY 3.0",
    "license_url": "https://creativecommons.org/licenses/by/3.0/",
    "changes": "Full official Wikimedia Commons 1080p derivative converted to H.264/AAC; source timing and image size preserved."
  }
];
