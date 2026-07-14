import {
  InstanceBase,
  InstanceStatus,
  runEntrypoint,
} from "@companion-module/base";
import { Connection } from "./connection.js";
import { apply, type ReducerEvent } from "./state.js";
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
import { projectVariables, variableDefinitions } from "./variables.js";
import { presetDefinitions } from "./presets.js";
import {
  configFields,
  defaultConfig,
  parseChannels,
  type ModuleConfig,
} from "./config.js";

class OverlaySysInstance extends InstanceBase<ModuleConfig> {
  private state: CompanionState = initialState();
  private connection: Connection | null = null;
  private channels: string[] = ["program", "preview"];
  private currentConfig: ModuleConfig = { ...defaultConfig };

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
    this.connection?.stop();
    this.connection = null;
  }

  async configUpdated(config: ModuleConfig): Promise<void> {
    this.currentConfig = { ...defaultConfig, ...config };
    this.channels = parseChannels(
      this.currentConfig.channels || defaultConfig.channels,
    );
    this.connection?.stop();
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
          this.connection?.send({ type: "stt_spawner_get_config" });
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
      feedbackDefinitionsForSDK(this.state, (id, options) =>
        feedbackPredicate(this.state, id, options),
      ),
    );
  }

  private refreshAll(): void {
    this.refreshDefinitions();
    this.setVariableDefinitions(variableDefinitions(this.channels, this.state));
    this.setPresetDefinitions(presetDefinitions());
    this.refreshDynamic();
  }

  private refreshDynamic(): void {
    this.setVariableValues(projectVariables(this.state, this.channels));
    this.checkFeedbacks();
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
        this.log("warn", "select_next_show: no show scheduled today or later");
      }
      return;
    }

    const { messages, localEvents } = dispatchAction(this.state, id, options);
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
    case "template_list":
    case "song_list":
    case "show":
    case "hotcard":
    case "template":
    case "channel":
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
      return true;
    case "show":
      return evt.show.id === state.loadedShowId;
    default:
      return false;
  }
}

runEntrypoint(OverlaySysInstance, []);
