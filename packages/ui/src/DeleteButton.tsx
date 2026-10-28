"use client";

import { useState, type MouseEventHandler } from "react";
import { Trash2 } from "lucide-react";
import { IconButton } from "./IconButton";
import { colors } from "./tokens";

type Props = {
  /** What gets deleted, e.g. "Sunday 9am" → "Delete Sunday 9am". */
  name: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  size?: number;
};

/** Trash icon button: dim at rest, danger red on hover or focus. */
export function DeleteButton({ name, onClick, disabled, size = 28 }: Props) {
  const [hot, setHot] = useState(false);
  const label = `Delete ${name}`;
  return (
    <IconButton
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      size={size}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      style={{
        borderColor: "transparent",
        color: disabled ? colors.textMuted : hot ? colors.dangerText : colors.textDim,
      }}
    >
      <Trash2 size={Math.round(size * 0.5)} aria-hidden />
    </IconButton>
  );
}
