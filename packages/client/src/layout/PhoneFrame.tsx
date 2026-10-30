import type { ReactNode } from "react";
import { useMe, useRunState } from "../store";
import { PrivacyFooter } from "../ui/PrivacyFooter";
import "./PhoneFrame.css";

/** Page furniture belongs below the navigation, outside every game pane. */
export function PhoneFrame({ children }: { children: ReactNode }): React.JSX.Element {
  const state = useRunState();
  const me = useMe();
  const lobby = me !== null && state?.chapterId === null && (state.phase === "lobby" || state.phase === "creation") && !state.closed;
  return <div className="kad-phone-frame" data-lobby-footer={lobby || undefined}>
    {children}
    {lobby ? <PrivacyFooter compact /> : null}
  </div>;
}
