import { DropletsIcon, ThermometerIcon } from "lucide-react"

import { type WeatherToolPart } from "@/lib/messages"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"

export function WeatherPart({ part }: { part: WeatherToolPart }) {
  switch (part.state) {
    // `input` is absent between tool-input-start and the first delta, so the
    // city has to be optional here rather than merely late.
    case "input-streaming":
    case "input-available":
      return (
        <div
          data-tool="get_weather"
          className="flex items-center gap-2 px-1.5 text-sm text-muted-foreground"
        >
          <Spinner />
          Checking the weather in {part.input?.city ?? "…"}
        </div>
      )
    case "output-available":
      return (
        <Item
          data-tool="get_weather"
          variant="muted"
          size="sm"
          className="w-fit"
        >
          <ItemContent>
            <ItemTitle>{part.output.city}</ItemTitle>
            <ItemDescription>{part.output.conditions}</ItemDescription>
          </ItemContent>
          <div className="flex items-center gap-3 text-sm text-muted-foreground tabular-nums">
            <span className="flex items-center gap-1">
              <ThermometerIcon className="size-3.5" />
              {part.output.temperature_c}°C
            </span>
            <span className="flex items-center gap-1">
              <DropletsIcon className="size-3.5" />
              {part.output.humidity_pct}%
            </span>
          </div>
        </Item>
      )
    case "output-error":
      return (
        <div
          data-tool="get_weather"
          className="px-1.5 text-sm text-destructive"
        >
          Weather lookup failed: {part.errorText}
        </div>
      )
    default:
      return null
  }
}
