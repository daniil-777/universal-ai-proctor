# Video recap v1 implementation contract

The recap is independent of interactive guidance confirmations. It analyzes an uploaded server-owned video end to end in bounded, sequential windows, streams accepted observations through polling, and freezes a JSON result. All visual findings cite sampled frames; reference instructions are expectations, not observations. Provider output never calculates authoritative totals directly.

## HTTP

- `GET /api/video-summary/plan?mode=detailed|balanced` returns `{ok:true, plan:{source_id,reference_key,source_name,duration_s,mode,window_s,total_windows,frames_per_window,estimated_model_calls,audio_available,max_duration_s}}`. No model call.
- `POST /api/video-summary/jobs` body `{source_id,reference_key,mode,provider?,model_id?,reasoning_effort?,domain_override?:DomainKey,include_audio?:boolean}` returns `{ok:true,job:VideoSummaryJob}` with status 202. An active equivalent job is reused; a conflicting job returns409. Reject stale input and unavailable/mock providers before spending work.
- `GET /api/video-summary/jobs/current` returns `{ok:true,job:VideoSummaryJob|null}` for this session/current input. Never expose another session's data.
- `GET /api/video-summary/jobs/:id` returns `{ok:true,job:VideoSummaryJob}`.
- `POST /api/video-summary/jobs/:id/cancel` returns `{ok:true,job:VideoSummaryJob}`.
- `POST /api/video-summary/jobs/:id/retry` resumes failed windows only if source, instruction definition and goals still match; returns202.
- `GET /api/video-summary/jobs/:id/report.json` downloads the immutable completed/partial job result; incomplete jobs return409.

## Public wire types

Backend `domain/videoSummary.ts` is authoritative. Frontend mirrors/validates these fields; additions must be communicated before implementation.

```ts
type DomainKey = 'surgery'|'construction'|'manufacturing'|'dance'|'sports'|'meeting'|'cooking'|'general';
type JobStatus = 'queued'|'planning'|'analyzing'|'synthesizing'|'complete'|'partial'|'cancelled'|'failed'|'stale';
type Domain = {key:DomainKey;label:string;basis:'video'|'document'|'both'|'operator'|'unclear';rationale:string;confidence:number;conflict:string|null};
type Frame = {id:string;time_s:number};
type Transcript = {id:string;start_s:number;end_s:number;text:string};
type Finding = {id:string;kind:'action'|'state'|'transition'|'decision'|'action_item';label:string;detail:string;start_s:number;end_s:number;frame_refs:string[];transcript_refs:string[];metric_ids:string[];certainty:'observed'|'estimated';uncertainty:string|null};
type MetricPlan = {id:string;label:string;question:string;kind:'count'|'timing'|'observable_state'|'document_criterion';unit:string;method:string;limitations:string};
type Metric = {id:string;label:string;value:number|null;unit:string;status:'measured'|'estimated'|'unavailable';method:string;evidence_refs:string[];explanation:string};
type Window = {id:string;start_s:number;end_s:number;status:'complete'|'failed';sampled_frames:Frame[];transcript:Transcript[];summary:string;narration:string;phase:string;events:Finding[];uncertainties:string[];error:string|null};
type Chapter = {id:string;title:string;start_s:number;end_s:number;summary:string;evidence_refs:string[]};
type Summary = {headline:string;overview:string;chapters:Chapter[];key_findings:{text:string;evidence_refs:string[]}[];limitations:string[]};
type VideoSummaryJob = {
 schema_version:1;id:string;status:JobStatus;created_at:string;updated_at:string;
 source:{id:string;name:string;duration_s:number;width:number;height:number};
 reference:{key:string;name:string};mode:'balanced'|'detailed';model:{provider:string;model_id:string};
 domain:Domain|null;metric_plan:MetricPlan[];metrics:Metric[];
 progress:{total_windows:number;completed_windows:number;failed_windows:number;analyzed_through_s:number;sampled_frames:number};
 windows:Window[];summary:Summary|null;error:string|null;
 audio:{requested:boolean;status:'pending'|'available'|'unavailable'|'no_audio'|'disabled';note:string|null};
 provenance:{visual_analysis:'sampled_frames';simulated:boolean;instruction_snapshot:string;model_calls:number};
};
```

## Processing and integrity

Detailed mode uses6second primary windows and up to9frames, then a second bounded visual verification call on the same images before acceptance. Verification may remove/rewrite/downscope findings and tags, but cannot introduce episodes, expand their intervals or upgrade uncertainty. Only verified summary/narration is retained; self-verification is not proof of accuracy. Balanced uses12second primary windows and up to6frames with one visual pass. Include bounded trailing context where useful. Maximum600windows; reject longer input for the chosen mode rather than silently dropping the tail. Plan estimates include detailed verification, optional speech calls and final synthesis. One active analysis globally and at most2queued; one active job/session. Retain structured records, not all JPEG buffers. Retry transient/malformed output once per window, then preserve a failed interval; final partial status is explicit. A manual retry reuses accepted windows.

Infer the domain from overview images plus bounded TXT/workflow context; surface conflicts and permit an explicit domain override. Select a small metric plan with relevance explanations. Server-derived metrics may count retained distinct events/states or observed phase spans, but sampled video cannot establish exhaustive cycles, physical measurements or an overall quality/safety score. Visual totals carry estimated/lower-bound explanations. Unavailable important domain metrics remain visible with the reason. Exact source duration, sampled frame count and successful analysis-window coverage are measured technical facts, not process quality.

The domain planner selects1–3 applicable IDs from a constrained per-domain observable metric catalog using the real overview and reference content, never filenames. Its internal response includes `selected_metric_ids`; the public plan retains the existing MetricPlan shape. Each Finding carries required `metric_ids` from the selected plan. Tags are selected observable catalog metrics or retained-event/span metrics; an event cannot establish source metadata or an unavailable conformance metric. Server validation checks event kinds and evidence requirements; meeting decision/action-item metrics require actual speech citations. Domain metric cards precede ancillary technical facts. Counts conservatively deduplicate matching overlapping episodes; spans use interval unions. A selected metric without supported retained findings is unavailable/null, never an asserted zero actual cycles or activity. Clinical outcomes, hidden defects, calibrated dimensions, internal temperature and overall safety/quality remain unavailable.

Retry creates a new job ID with accepted windows reused. Previously completed/partial job reports remain immutable and downloads stay pinned to the original ID.

Each window gets server-owned frame IDs/timestamps. Reject invented refs, invalid time bounds, foreign metric IDs, malformed numbers and unsupported empty-citation claims. Deduplicate overlapping episode records conservatively, preserve edited-scene uncertainty, and compute interval unions without double counting. Final synthesis can only cite accepted retained evidence and cannot upgrade uncertainty or change measured totals. Use bounded hierarchical context if needed.

Optional audio uses an injected reader `readAudio({path,start_s,end_s,signal}):Promise<{status:'available'|'no_audio'|'unavailable';segments:Transcript[];note:string|null}>`. Root owns the real audio adapter. Text is actual transcribed speech with source timestamps, never inferred from silent images. Missing/failed audio is explicit. No speaker identification from appearance.

Jobs pin source ID, media generation, path, instruction-definition hash and preferences revision. Changing source, document or goals aborts the active request and invalidates current-job display. Seeking/playback/progress changes do not invalidate the independent analysis. Session disposal/app shutdown abort jobs before deleting owned files. Model output and documents remain untrusted data.

## Frontend

One job hook in the app provider; preflight on explicit open/start, cancel/retry, bounded polling only while active. A Recap tab/action opens a restrained large summary dialog: strong typography, generous spacing, quiet surfaces, clear domain label, metric cards, chapter rail and evidence details. JSON download is pinned to job ID. Domain override/accuracy/audio options precede Start. Show actual window progress and analysis lag without implying every video frame was watched.

Narration is explicit opt-in, routed through the existing shared speech engine as low priority below alerts and chat. It follows accepted window records at playback time, never speaks future windows, skips stale backlog after seek, stops on source change/disable, and never interrupts a chat answer. Video ended opens the recap only when analysis finishes; if it is still running, show real progress then open when ready. The old uploaded-video observation loop remains suspended while a recap snapshot is retained for the same source, instruction definition and goals, including completed snapshots; this prevents automatic inferred-step changes from displacing the recap. Pending start/retry also owns observation. Active status alone determines polling. Changing source, instructions or goals releases this ownership; camera/screen behavior remains available.

Retention also has a global 64 MiB serialized-terminal-report budget. Finalization accounts each result once and evicts the oldest terminal snapshots as needed. Active and queued work is protected. This budget does not represent total process RAM, native decoder memory or transient serialization buffers.
