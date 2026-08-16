import { type AnalyzeToolPart } from "@/lib/messages"
import { Spinner } from "@/components/ui/spinner"

/**
 * `analyze` sleeps ~3s on purpose — this component is the latency axis. The
 * topic is already on screen while the call is in flight, so the wait says what
 * it is waiting on rather than only that it is waiting.
 */
export function AnalyzePart({ part }: { part: AnalyzeToolPart }) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return (
        <div
          data-tool="analyze"
          className="flex shimmer items-center gap-2 px-1.5 text-sm text-muted-foreground"
        >
          <Spinner />
          Analyzing {part.input?.topic ?? "…"}
        </div>
      )
    case "output-available":
      return (
        <div
          data-tool="analyze"
          className="border-l-2 px-3 text-sm text-muted-foreground"
        >
          {part.output}
        </div>
      )
    case "output-error":
      return (
        <div data-tool="analyze" className="px-1.5 text-sm text-destructive">
          Analysis failed: {part.errorText}
        </div>
      )
    default:
      return null
  }
}
