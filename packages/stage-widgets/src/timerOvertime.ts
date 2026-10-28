export type OvertimeStyle = "text" | "fill" | "flash";

export interface OvertimeView {
  color?: string;
  /** The literal "overColor" means: use the widget's overColor prop. */
  background?: string;
  pulse: boolean;
}

export const OVER_BACKGROUND = "overColor";

/** 1 Hz pulse: bright for the first half of each second. */
export function pulseOn(nowMs: number): boolean {
  return Math.floor(nowMs / 500) % 2 === 0;
}

export function overtimeView(style: OvertimeStyle | undefined, over: boolean, _nowMs: number): OvertimeView {
  if (!over || (style !== "fill" && style !== "flash")) return { pulse: false };
  return { background: OVER_BACKGROUND, color: "#ffffff", pulse: style === "flash" };
}
