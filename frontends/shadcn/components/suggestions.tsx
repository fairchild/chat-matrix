"use client"

import { Button } from "@/components/ui/button"

// One suggestion per comparison axis, same three prompts as every other cell.
const suggestions = [
  { label: "Weather", prompt: "What's the weather in Tokyo?" },
  { label: "Search notes", prompt: "Search notes for streaming protocols." },
  {
    label: "Analyze (slow)",
    prompt: "Analyze assistant-ui as a chat frontend.",
  },
]

export function Suggestions({
  onSelect,
}: {
  onSelect: (prompt: string) => void
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion.label}
          variant="outline"
          size="sm"
          onClick={() => onSelect(suggestion.prompt)}
        >
          {suggestion.label}
        </Button>
      ))}
    </div>
  )
}
