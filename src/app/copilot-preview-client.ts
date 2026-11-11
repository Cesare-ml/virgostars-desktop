/**
 * Optional transport boundary for the PRIVATE Virgo Stars AI service.
 *
 * The desktop never chooses providers or handles OpenAI/Anthropic API keys.
 * A future audited Tauri host adapter will supply authenticated requests.
 * No transport is installed by default: offline/guest use never contacts a server.
 */
export type CopilotPreviewFocus =
  | Readonly<{ layer: 'NATAL'; bodyId: 'VENUS' | 'SUN' }>
  | Readonly<{ layer: 'TRANSIT'; bodyId: 'SATURN' }>;

export const COPILOT_PREVIEW_MESSAGE_PATH = '/api/v1/ai/copilot-preview/message';

export interface VirgoStarsCopilotPreviewTransport {
  /**
   * Read-only capability check. True means the native bridge received a
   * valid authenticated SYNTHETIC capabilities response from Virgo Stars staging.
   * Not a production account session, PKCE login, or a real-chart permission.
   */
  isAvailable(): Promise<boolean>;
  /** Must use ONLY the authenticated Virgo Stars backend and protected native token storage. */
  postJson(path: typeof COPILOT_PREVIEW_MESSAGE_PATH, body: Readonly<{
    action: 'describe_focus';
    focus: CopilotPreviewFocus;
  }>, signal: AbortSignal): Promise<unknown>;
}

export interface CopilotPreviewReply {
  readonly answer: string;
  readonly chartRevision: number;
  readonly focus: CopilotPreviewFocus;
  readonly synthetic: true;
  /** Informational only, NOT applied to the current rendered chart. */
  readonly illustrativeAspectCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isCopilotPreviewFocus(value: unknown): value is CopilotPreviewFocus {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false;
  return (value.layer === 'NATAL' && (value.bodyId === 'VENUS' || value.bodyId === 'SUN'))
    || (value.layer === 'TRANSIT' && value.bodyId === 'SATURN');
}

function invalid(): never {
  throw new Error('virgostars_copilot_preview_invalid_response');
}

/**
 * Fail closed on non-staging, non-synthetic responses until real chart ownership,
 * scientific calculation and method-review gates have passed. No chart commands
 * from the backend are executed here: fixture IDs must never affect real charts.
 */
export function readCopilotPreviewReply(raw: unknown, expectedFocus: CopilotPreviewFocus): CopilotPreviewReply {
  if (!isRecord(raw)
    || raw.contract !== 'VirgoStarsCopilotMockPreviewEnvelope'
    || raw.version !== '0.1.0'
    || raw.stage !== 'STAGING_SYNTHETIC'
    || raw.syntheticFixture !== true
    || raw.astrologyIsReal !== false
    || raw.methodApproved !== false
    || raw.providerInvoked !== false
    || raw.interpretationStatus !== 'FACT_ONLY'
    || !isRecord(raw.data)) invalid();

  const data = raw.data;
  if (typeof data.answer !== 'string' || data.answer.length === 0 || data.answer.length > 4000
    || typeof data.chartRevision !== 'number' || !Number.isSafeInteger(data.chartRevision)
    || data.chartRevision < 0 || data.source !== 'MOCK_DETERMINISTIC'
    || !isCopilotPreviewFocus(data.focus)
    || data.focus.layer !== expectedFocus.layer
    || data.focus.bodyId !== expectedFocus.bodyId) invalid();

  if (!Array.isArray(data.chartCommands) || data.chartCommands.length !== 1) invalid();
  const command: unknown = data.chartCommands[0];
  if (!isRecord(command) || command.type !== 'chart.highlightAspects'
    || !Array.isArray(command.aspectIds) || command.aspectIds.length > 80
    || command.aspectIds.some(id => typeof id !== 'string' || !/^synthetic:[a-z0-9:-]{1,96}$/.test(id))
    || new Set(command.aspectIds).size !== command.aspectIds.length) invalid();

  return Object.freeze({
    answer: data.answer,
    chartRevision: data.chartRevision,
    focus: expectedFocus,
    synthetic: true,
    illustrativeAspectCount: command.aspectIds.length,
  });
}

export async function requestCopilotPreview(
  transport: VirgoStarsCopilotPreviewTransport,
  focus: CopilotPreviewFocus,
  signal: AbortSignal,
): Promise<CopilotPreviewReply> {
  if (!isCopilotPreviewFocus(focus)) throw new TypeError('invalid_copilot_preview_focus');
  if (signal.aborted) throw new Error('copilot_preview_cancelled');
  // This is a synthetic preview request, NEVER a real theme, birth record or free-form prompt.
  const raw = await transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, {
    action: 'describe_focus', focus: Object.freeze({ layer: focus.layer, bodyId: focus.bodyId }),
  }, signal);
  if (signal.aborted) throw new Error('copilot_preview_cancelled');
  return readCopilotPreviewReply(raw, focus);
}
