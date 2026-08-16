import type { Metadata } from "next"

import { Chat } from "@/components/chat"

export const metadata: Metadata = {
  title: "shadcn × pydantic-ai",
  description:
    "The shadcn chatbot template as a cell in the chat-stack matrix, talking to the pydantic-ai backend over the Vercel AI data stream protocol.",
}

export default function Page() {
  return <Chat />
}
