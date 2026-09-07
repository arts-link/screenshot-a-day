import { useRef, useState } from "react";
import { Button } from "./components";

type CopyFeedback = "idle" | "copied" | "manual";

export function CopyableValue({
  value,
  label,
  copyLabel,
  manualLabel,
  copiedMessage,
  manualMessage,
}: {
  value: string;
  label: string;
  copyLabel: string;
  manualLabel: string;
  copiedMessage: string;
  manualMessage: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<CopyFeedback>("idle");

  const selectValue = () => {
    input.current?.focus();
    input.current?.select();
    setFeedback("manual");
  };

  const copyValue = async () => {
    try {
      if (!globalThis.navigator.clipboard) throw new Error("Clipboard API unavailable");
      await globalThis.navigator.clipboard.writeText(value);
      setFeedback("copied");
    } catch {
      selectValue();
    }
  };

  return (
    <div className="copyable-value">
      <div className="token-reveal-value">
        <input
          ref={input}
          className="copyable-value-input"
          aria-label={label}
          value={value}
          readOnly
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void (feedback === "manual" ? selectValue() : copyValue())}
        >
          {feedback === "copied" ? "Copied ✓" : feedback === "manual" ? manualLabel : copyLabel}
        </Button>
      </div>
      {feedback === "copied" ? (
        <p className="copyable-value-feedback" role="status">
          {copiedMessage}
        </p>
      ) : null}
      {feedback === "manual" ? (
        <p className="copyable-value-feedback copyable-value-feedback-error" role="alert">
          {manualMessage}
        </p>
      ) : null}
    </div>
  );
}
