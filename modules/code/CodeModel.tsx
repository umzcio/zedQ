import { Input, SelectField } from "@zq/ui";

const options = [
  { value: "default", label: "Profile default" },
  { value: "sonnet", label: "Sonnet · Everyday coding" },
  { value: "opus", label: "Opus · Complex reasoning" },
  { value: "haiku", label: "Haiku · Quick, simple tasks" },
  { value: "custom", label: "Specific model…" },
];
export function CodeModel({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const custom = !options.slice(0, 4).some((option) => option.value === value);
  return (
    <div className="code-model-field">
      <label>
        Model
        <SelectField
          label="Claude model"
          value={custom ? "custom" : value}
          onValueChange={(next) => onChange(next === "custom" ? "" : next)}
          options={options}
        />
      </label>
      {custom && (
        <Input
          aria-label="Specific Claude model"
          placeholder="Model ID from your provider"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={200}
          required
        />
      )}
      <p className="code-muted">
        {value === "default"
          ? "Uses your launcher's configured model. Your account profile and model are separate choices."
          : value === "sonnet"
            ? "A balanced choice for most coding work."
            : value === "opus"
              ? "For difficult debugging and design decisions; typically uses more of your allowance."
              : value === "haiku"
                ? "For quick questions and straightforward edits."
                : "Use an exact model ID supported by this profile."}{" "}
        Availability depends on your account.
      </p>
    </div>
  );
}
