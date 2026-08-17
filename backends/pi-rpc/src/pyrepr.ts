/**
 * Python's `repr` and `json.dumps` spellings, for the few values the scripted
 * model prints. Matching pydantic-ai byte for byte is what keeps the backend
 * axis clean: the same prompt streams the same text from either backend, so a
 * difference between two cells is the frontend and nothing else.
 */

export const py = (value: unknown): string => {
  if (typeof value === "string")
    return value.includes("'") && !value.includes('"')
      ? `"${value}"`
      : `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  return String(value);
};

export const pyTuple = (items: readonly unknown[]) =>
  `(${items.map(py).join(", ")}${items.length === 1 ? "," : ""})`;

/** `json.dumps` spacing, for the flat string dicts these tools take. */
export const pyJson = (args: Record<string, string>) =>
  `{${Object.entries(args)
    .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join(", ")}}`;
