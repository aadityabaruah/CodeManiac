import { lazy, Suspense, type ComponentProps } from "react";
import type { TerminalPanel as PanelType } from "../Terminal";
import { t } from "@/lib/i18n";

const Panel = lazy(() => import("../Terminal").then((module) => ({ default: module.TerminalPanel })));

export function TerminalPanel(props: ComponentProps<typeof PanelType>) {
  return (
    <Suspense fallback={<div role="status" className="p-4 text-body text-muted-foreground">{t("terminal.loading")}</div>}>
      <Panel {...props} />
    </Suspense>
  );
}
