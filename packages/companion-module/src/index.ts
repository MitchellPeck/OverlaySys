import {
  InstanceBase,
  InstanceStatus,
  runEntrypoint,
} from "@companion-module/base";
import { Connection } from "./connection.js";
import { apply, hasRunningWork, type ReducerEvent } from "./state.js";
import { initialState, type CompanionState } from "./types.js";
import {
  dispatchAction,
  selectNextShowResult,
  actionDefinitions,
  type ActionId,
  type ActionOptions,
} from "./actions.js";
import { toISODate } from "@overlaysys/core";
import {
  feedbackPredicate,
  feedbackDefinitionsForSDK,
} from "./feedbacks.js";
import { projectVariables, rundownPageVariables, variableDefinitions } from "./variables.js";
import { presetDefinitions } from "./presets.js";
import { sttVariables, videoVariables } from "./live.js";
import { protocolMismatch, PROTOCOL_VERSION } from "@overlaysys/ws-protocol";
import {
  configFields,
  defaultConfig,
  parseChannels,
  type ModuleConfig,
  rowKindPages,
} from "./config.js";

class OverlaySysInstance extends InstanceBase<ModuleConfig> {
  private state: CompanionState = initialState();
  private connection: Connection | null = null;
  private timerTick: ReturnType<typeof setInterval> | null = null;
  private channels: string[] = ["program", "preview"];
  private currentConfig: ModuleConfig = { ...defaultConfig };
  /** Last values pushed for the high-rate (video / STT) variables, to send only changes. */
  private fastValues: Record<string, string> = {};

  async init(config: ModuleConfig): Promise<void> {
    this.currentConfig = { ...defaultConfig, ...config };
    this.channels = parseChannels(
      this.currentConfig.channels || defaultConfig.channels,
    );

    if (this.currentConfig.loadedShowId) {
      this.state = apply(this.state, {
        type: "local_load_show",
        showId: this.currentConfig.loadedShowId,
      });
    }

    this.refreshAll();
    this.openConnection();
  }

  async destroy(): Promise<void> {
    if (this.timerTick) clearInterval(this.timerTick);
    this.timerTick = null;
    this.connection?.stop();
    this.connection = null;
  }

  async configUpdated(config: ModuleConfig): Promise<void> {
    this.currentConfig = { ...defaultConfig, ...config };
    this.channels = parseChannels(
      this.currentConfig.channels || defaultConfig.channels,
    );
    this.connection?.stop();
    this.applyEvent({ type: "local_reset_live" });
    this.openConnection();
    this.refreshAll();
  }

  getConfigFields() {
    return configFields();
  }

  private openConnection(): void {
    this.connection = new Connection(
      {
        host: this.currentConfig.host,
        port: this.currentConfig.port,
        token: this.currentConfig.token,
      },
      {
        onConnected: () => {
          this.updateStatus(InstanceStatus.Ok);
          this.applyEvent({ type: "local_connected" });
          for (const c of this.channels) {
            this.connection?.send({
              type: "subscribe",
              channel: c,
              role: "operator",
            });
          }
          this.connection?.send({ type: "list_templates" });
          this.connection?.send({ type: "list_shows" });
          this.connection?.send({ type: "list_songs" });
          this.connection?.send({ type: "list_hotcards" });
          this.connection?.send({ type: "list_channels" });
          this.connection?.send({ type: "list_stage_layouts" }); // [P2b.34]
          this.connection?.send({ type: "stt_spawner_get_config" });
          // STT suggestions are opt-in (STT confidence / silence variables).
          this.connection?.send({ type: "stt_match_subscribe", on: true });
          if (this.state.loadedShowId) {
            this.connection?.send({
              type: "get_show",
              showId: this.state.loadedShowId,
            });
          }
        },
        onDisconnected: () => {
          this.updateStatus(InstanceStatus.Disconnected);
          this.applyEvent({ type: "local_disconnected" });
        },
        onReconnecting: () => {
          this.updateStatus(InstanceStatus.Connecting);
          this.applyEvent({ type: "local_reconnecting" });
        },
        onMessage: (msg) => {
          // ~4 Hz playback ticks and several-per-second STT suggestions only
          // move the video / STT variables: update those when their
          // whole-second values change, skip the full refresh.
          if (msg.type === "media_playback" || msg.type === "stt_match") {
            this.state = apply(this.state, msg);
            this.pushFastValues();
            return;
          }
          if (msg.type === "hello" && protocolMismatch(msg.protocolVersion)) {
            this.log(
              "warn",
              `server speaks protocol v${msg.protocolVersion}, this module v${PROTOCOL_VERSION} — update the older side; some actions may not work`,
            );
          }
          this.applyEvent(msg);
          if (msg.type === "hotcard_list") {
            for (const h of msg.hotcards) {
              if (!this.state.hotcardCache.has(h.id)) {
                this.connection?.send({
                  type: "get_hotcard",
                  hotcardId: h.id,
                });
              }
            }
          }
        },
        onLog: (level, message) => this.log(level, message),
      },
    );
    this.connection.start();
  }

  private applyEvent(evt: ReducerEvent): void {
    this.state = apply(this.state, evt);
    if (mutatesDropdownSources(evt)) {
      this.refreshDefinitions();
    }
    if (evt.type === "hotcard_list" || evt.type === "hotcard") {
      this.setPresetDefinitions(presetDefinitions(this.state));
    }
    if (mutatesRundownVariables(evt, this.state)) {
      this.setVariableDefinitions(
        variableDefinitions(this.channels, this.state),
      );
    }
    this.refreshDynamic();
  }

  private refreshDefinitions(): void {
    this.setActionDefinitions(
      actionDefinitions(this.state, (id, options) =>
        this.runAction(id, options),
      ),
    );
    this.setFeedbackDefinitions(
      feedbackDefinitionsForSDK(
        this.state,
        (id, options) => feedbackPredicate(this.state, id, options),
        () => this.state,
      ),
    );
  }

  private refreshAll(): void {
    this.refreshDefinitions();
    this.setVariableDefinitions(variableDefinitions(this.channels, this.state));
    this.setPresetDefinitions(presetDefinitions(this.state));
    this.refreshDynamic();
  }

  private refreshDynamic(): void {
    const all = {
      ...projectVariables(this.state, this.channels),
      ...rundownPageVariables(this.state, rowKindPages(this.currentConfig)),
    };
    this.setVariableValues(all);
    this.fastValues = { ...videoVariables(this.state, this.channels), ...sttVariables(this.state) };
    this.checkFeedbacks();
    this.syncTimerTick();
  }

  /** Push only the video / STT variables that changed since last time. */
  private pushFastValues(): void {
    const next = { ...videoVariables(this.state, this.channels), ...sttVariables(this.state) };
    const changed: Record<string, string> = {};
    for (const [k, v] of Object.entries(next)) if (this.fastValues[k] !== v) changed[k] = v;
    if (Object.keys(changed).length === 0) return;
    this.fastValues = next;
    this.setVariableValues(changed);
    this.checkFeedbacks("video_remaining_below", "video_errored", "stt_silent");
  }

  /** Re-project timer-driven variables/feedbacks every second while any timer runs. */
  private syncTimerTick(): void {
    const running = hasRunningWork(this.state);
    if (running && !this.timerTick) {
      this.timerTick = setInterval(() => {
        this.setVariableValues(projectVariables(this.state, this.channels));
        this.checkFeedbacks("item_timer_warning", "item_timer_overtime", "stt_silent");
      }, 1000);
    } else if (!running && this.timerTick) {
      clearInterval(this.timerTick);
      this.timerTick = null;
    }
  }

  private runAction(id: ActionId, options: ActionOptions): void {
    if (id === "select_next_show") {
      const todayISO = toISODate(new Date());
      const { messages, localEvents } = selectNextShowResult(
        this.state,
        todayISO,
      );
      for (const e of localEvents) this.applyEvent(e);
      for (const m of messages) this.connection?.send(m);
      const loaded = localEvents.find((e) => e.type === "local_load_show");
      if (loaded && loaded.type === "local_load_show") {
        this.currentConfig = {
          ...this.currentConfig,
          loadedShowId: loaded.showId,
        };
        this.saveConfig(this.currentConfig);
      } else {
        this.log(
          "warn",
          "select_next_show: no show carries a date — set a service date in " +
            "the show editor, or put M/D/YY in the show name",
        );
      }
      return;
    }

    const { messages, localEvents, warnings } = dispatchAction(this.state, id, options);
    for (const w of warnings ?? []) this.log("warn", w);
    for (const e of localEvents) this.applyEvent(e);
    for (const m of messages) this.connection?.send(m);

    if (id === "load_show" && typeof options.showId === "string") {
      this.currentConfig = {
        ...this.currentConfig,
        loadedShowId: options.showId,
      };
      this.saveConfig(this.currentConfig);
    }
    if (id === "clear_loaded_show") {
      this.currentConfig = { ...this.currentConfig, loadedShowId: "" };
      this.saveConfig(this.currentConfig);
    }
  }
}

/**
 * Returns true when the event changes anything that feeds an action or
 * feedback dropdown. Companion only sees dropdown choices after we call
 * setActionDefinitions / setFeedbackDefinitions, so we re-emit whenever
 * the underlying lists move.
 */
function mutatesDropdownSources(evt: ReducerEvent): boolean {
  switch (evt.type) {
    // Server-pushed list updates and individual upserts feed dropdowns
    // (shows, hotcards, templates, channels, rows).
    case "show_list":
    case "hotcard_list":
    case "channel_list":
    case "stage_layout_list": // [P2b.34]
    case "template_list":
    case "song_list":
    case "show":
    case "hotcard":
    case "template":
    case "channel":
    case "timers_state":
    // Loaded-show pointer + cursor changes affect the row dropdown.
    case "local_load_show":
    case "local_clear_loaded_show":
    case "local_cursor_set":
    case "local_cursor_advance":
      return true;
    default:
      return false;
  }
}

/**
 * True when an event changes the loaded show's rows, so the dynamic
 * `rundown_<n>_field_*` variable *definitions* must be regenerated. `state` is
 * post-apply, so a `show` upsert is only relevant when it is the loaded show.
 */
function mutatesRundownVariables(
  evt: ReducerEvent,
  state: CompanionState,
): boolean {
  switch (evt.type) {
    case "local_load_show":
    case "local_clear_loaded_show":
    // [P2b.34] stage-layout variables are per stage channel
    case "channel_list":
    case "channel":
    case "stage_layout_list":
      return true;
    case "show":
      return evt.show.id === state.loadedShowId;
    default:
      return false;
  }
}

runEntrypoint(OverlaySysInstance, []);
