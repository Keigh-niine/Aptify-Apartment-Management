import { NextResponse, type NextRequest } from "next/server";
import { categories, urgencies } from "@/lib/tenant-maintenance";
import { createClient } from "@/lib/supabase/server";

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DESCRIPTION_SYSTEM_INSTRUCTION =
  "Write a concise maintenance request description in 1 to 3 sentences. Use only facts present in the title, category, and urgency. Return only the description.";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Please sign in to use this feature." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "The request is invalid." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const category = categories.find((item) => item.value === input.category)?.value;
  const urgency = urgencies.find((item) => item.value === input.urgency)?.value;

  if (!title || title.length > MAX_TITLE_LENGTH || !category || !urgency) {
    return NextResponse.json(
      { error: "Enter a title and select a valid category and urgency." },
      { status: 400 }
    );
  }

  const { data: lease, error: leaseError } = await supabase
    .from("leases")
    .select("unit_id")
    .eq("tenant_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (leaseError) {
    console.error("Could not verify tenant lease for AI description.", leaseError.message);
    return NextResponse.json({ error: "Couldn't verify your tenant account." }, { status: 500 });
  }
  if (!lease) {
    return NextResponse.json(
      { error: "Join a unit before generating a maintenance description." },
      { status: 403 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI descriptions are not configured yet. Please try again later." },
      { status: 503 }
    );
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
  let aiResponse: Response;
  try {
    aiResponse = await fetch(`${GEMINI_API_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: DESCRIPTION_SYSTEM_INSTRUCTION }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify({ title, category, urgency }) }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 300,
        },
      }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    console.error("Gemini request failed.", error);
    return NextResponse.json(
      { error: "Couldn't reach the AI service. Please try again." },
      { status: 502 }
    );
  }

  if (!aiResponse.ok) {
    console.error("Gemini returned an unsuccessful response.", aiResponse.status);
    return NextResponse.json(
      { error: "The AI service couldn't write a description. Please try again." },
      { status: 502 }
    );
  }

  let completion: unknown;
  try {
    completion = await aiResponse.json();
  } catch {
    return NextResponse.json(
      { error: "The AI service returned an invalid response. Please try again." },
      { status: 502 }
    );
  }

  const candidates =
    completion && typeof completion === "object" && "candidates" in completion
      ? completion.candidates
      : undefined;
  const firstCandidate = Array.isArray(candidates) ? candidates[0] : undefined;
  const content =
    firstCandidate && typeof firstCandidate === "object" && "content" in firstCandidate
      ? firstCandidate.content
      : undefined;
  const parts =
    content && typeof content === "object" && "parts" in content ? content.parts : undefined;
  const description =
    Array.isArray(parts)
      ? parts
          .map((part) =>
            part && typeof part === "object" && "text" in part && typeof part.text === "string"
              ? part.text
              : ""
          )
          .join("")
          .trim()
      : "";

  if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { error: "The AI couldn't write a usable description. Please try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ description });
}