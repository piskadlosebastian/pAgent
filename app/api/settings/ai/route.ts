import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AI_AGENTS, DEFAULT_AI_AGENT_ID, getAiAgent, isAiAgentId } from "@/lib/ai-agents";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: session.user.organizationId },
    select: {
      aiProvider: true
    }
  });

  const selectedAgent = getAiAgent(org?.aiProvider);
  return NextResponse.json({
    selectedAgentId: selectedAgent.id,
    agents: AI_AGENTS
  });
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const selectedAgentId = isAiAgentId(body.agentId) ? body.agentId : DEFAULT_AI_AGENT_ID;
  const selectedAgent = getAiAgent(selectedAgentId);
  
  await prisma.organization.update({
    where: { id: session.user.organizationId },
    data: {
      aiProvider: selectedAgent.id,
      aiModel: selectedAgent.model ?? null,
      aiApiUrl: null,
      aiApiKey: null,
    }
  });

  return NextResponse.json({ success: true, selectedAgentId: selectedAgent.id });
}
