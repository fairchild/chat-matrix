import { NotebookIcon } from "lucide-react"

import { type SearchNotesToolPart } from "@/lib/messages"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"

export function NotesPart({ part }: { part: SearchNotesToolPart }) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return (
        <div
          data-tool="search_notes"
          className="flex items-center gap-2 px-1.5 text-sm text-muted-foreground"
        >
          <Spinner />
          Searching notes{part.input?.query ? ` for “${part.input.query}”` : ""}
          …
        </div>
      )
    case "output-available":
      return (
        <ItemGroup data-tool="search_notes" className="px-1.5">
          {part.output.map((note) => (
            <Item key={note.title} variant="outline" size="sm">
              <ItemMedia variant="icon">
                <NotebookIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{note.title}</ItemTitle>
                <ItemDescription className="line-clamp-none">
                  {note.body}
                </ItemDescription>
                <div className="mt-1 flex flex-wrap gap-1">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      )
    case "output-error":
      return (
        <div
          data-tool="search_notes"
          className="px-1.5 text-sm text-destructive"
        >
          Note search failed: {part.errorText}
        </div>
      )
    default:
      return null
  }
}
