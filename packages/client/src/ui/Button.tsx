/**
 * The one button.
 *
 * Two rules from spec §11 are enforced here rather than left to each screen:
 * the box is never smaller than `--kad-touch-min` ("a small hand and imprecise
 * taps", and it stays that way in Travel Mode's compressed pane), and there is
 * an `icon` slot because no interactive element ships without one — the label
 * is the caption, not the interface.
 *
 * There is no hover-only state: everything hover does, `:active` and
 * `:focus-visible` also do.
 */

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
// The tap cue lives here so every interactive element sounds like a tap
// without any screen remembering to say so — the same reasoning as the
// touch-min rule above. A no-op wherever no audio sink is installed.
import { cue } from "../audio/cue";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  children?: ReactNode;
  /** An icon, an emoji, or an <img>. Required in spirit; optional in types. */
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  selected?: boolean;
  className?: string;
}

export function Button({
  children,
  icon,
  variant = "primary",
  size = "md",
  block = false,
  selected = false,
  className = "",
  type = "button",
  onClick,
  ...rest
}: ButtonProps): React.JSX.Element {
  const clickWithCue = (event: MouseEvent<HTMLButtonElement>): void => {
    cue("tap");
    onClick?.(event);
  };
  const classes = [
    "kad-button",
    `kad-button--${variant}`,
    `kad-button--${size}`,
    block ? "kad-button--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      aria-pressed={selected || undefined}
      onClick={clickWithCue}
      {...rest}
    >
      {icon !== undefined && (
        <span className="kad-button__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children !== undefined && <span className="kad-button__label">{children}</span>}
    </button>
  );
}
