"use client"

import { type ChatUIMessage } from "@/lib/messages"
import { AnalyzePart } from "@/components/parts/analyze-part"
import { NotesPart } from "@/components/parts/notes-part"
import { SourcesPart } from "@/components/parts/sources-part"
import { TextPart } from "@/components/parts/text-part"
import { WeatherPart } from "@/components/parts/weather-part"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"

export function ChatMessage({
  message,
  isStreaming = false,
}: {
  message: ChatUIMessage
  isStreaming?: boolean
}) {
  if (message.role === "user") {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="muted">
            <BubbleContent>
              {message.parts
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("")}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  return (
    <Message align="start">
      <MessageContent>
        {message.parts.map((part, index) => {
          // One case per tool the reference agent implements. `default` is a
          // real decision here, not a fallthrough: an unrecognised tool renders
          // nothing at all, so this switch is the whole tool-call UI.
          switch (part.type) {
            case "text":
              return <TextPart key={index} part={part} />
            case "tool-get_weather":
              return <WeatherPart key={part.toolCallId} part={part} />
            case "tool-search_notes":
              return <NotesPart key={part.toolCallId} part={part} />
            case "tool-analyze":
              return <AnalyzePart key={part.toolCallId} part={part} />
            default:
              return null
          }
        })}
        {!isStreaming && <SourcesPart parts={message.parts} />}
      </MessageContent>
    </Message>
  )
}
