"use client";
import { useState } from "react";
import { Check, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import {
  labels,
  limits,
  formatLimit,
  unitless,
  type Conversation,
  type Turn,
} from "@/lib/types";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
export function Constraints({
  conversation,
  disabled,
  onTurn,
}: {
  conversation: Conversation;
  disabled: boolean;
  onTurn: (t: Omit<Turn, "version">) => void;
}) {
  const [edit, setEdit] = useState(false),
    [key, setKey] = useState("cash_min"),
    [value, setValue] = useState(""),
    [remove, setRemove] = useState(false);
  const confirmed = conversation.confirmedConstraints,
    proposal = conversation.proposedConstraints;
  const multiplier = unitless.has(key) ? 1 : 100;
  const number = value.trim() === "" ? NaN : Number(value) / multiplier;
  const valid =
    remove ||
    (Number.isFinite(number) &&
      number >= 0 &&
      number <= limits[key as keyof typeof limits]);
  return (
    <section className="constraint-panel">
      <header>
        <ShieldCheck size={17} />
        <h3>Investment constraints</h3>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => setEdit(true)}
          aria-label="Edit constraints"
        >
          <SlidersHorizontal size={15} />
        </Button>
      </header>
      <div className="confirmed-label">CONFIRMED BY YOU</div>
      {Object.keys(confirmed).length ? (
        <dl>
          {Object.entries(confirmed).map(([k, v]) => (
            <div key={k}>
              <dt>{labels[k] ?? k}</dt>
              <dd>{formatLimit(k, v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted small">
          No confirmed limits yet. Suggestions and illustrative presets are not
          your requirements.
        </p>
      )}
      {proposal !== null && (
        <div className="proposal">
          <div className="eyebrow">PROPOSED CHANGES</div>
          {Object.entries(proposal).map(([k, v]) => (
            <p key={k}>
              <span>{labels[k] ?? k}</span>
              <strong>
                {k in confirmed ? formatLimit(k, confirmed[k]) : "Not set"}{" "}
                <span className="muted">→</span> {formatLimit(k, v)}
              </strong>
            </p>
          ))}
          <div className="proposal-actions">
            <Button
              size="sm"
              disabled={disabled}
              onClick={() =>
                onTurn({
                  prompt: "Confirm the displayed proposed constraint changes.",
                  action: "confirm",
                })
              }
            >
              <Check size={14} />
              Confirm change
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() =>
                onTurn({
                  prompt:
                    "Discard the proposed changes; keep all confirmed constraints.",
                  action: "reject",
                })
              }
            >
              <X size={14} />
              Discard
            </Button>
          </div>
        </div>
      )}
      <footer>Limits apply together. Changes require your confirmation.</footer>
      <Dialog
        open={edit}
        onOpenChange={setEdit}
        title="Edit a constraint"
        description="Review and confirm this one change. Every other confirmed limit remains in force."
      >
        <label className="field">
          Constraint
          <select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setValue("");
            }}
          >
            {Object.keys(limits).map((k) => (
              <option key={k} value={k}>
                {labels[k] ?? k}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          New limit {unitless.has(key) ? "(unitless)" : "(%)"}
          <input
            type="number"
            min={0}
            step="any"
            max={limits[key as keyof typeof limits] * multiplier}
            value={value}
            disabled={remove}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={remove}
            onChange={(e) => setRemove(e.target.checked)}
          />
          Remove this limit
        </label>
        <p className="review-change">
          {labels[key]}:{" "}
          {key in confirmed ? formatLimit(key, confirmed[key]) : "Not set"} →{" "}
          {remove
            ? "Removed"
            : valid
              ? formatLimit(key, number)
              : "Enter a valid limit"}
        </p>
        <Button
          disabled={!valid || disabled}
          onClick={() => {
            onTurn({
              prompt: `Apply my explicitly confirmed change: ${labels[key]} ${remove ? "removed" : formatLimit(key, number)}. Keep all other limits.`,
              action: "edit",
              constraints: { [key]: remove ? null : number },
            });
            setEdit(false);
          }}
        >
          Confirm and apply
        </Button>
      </Dialog>
    </section>
  );
}
