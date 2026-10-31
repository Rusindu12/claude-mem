import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AiRouterService } from '../ai-router/ai-router.service';
import { ChatTurnMessage } from '../ai-providers/ai-providers.service';
import { StorageModule, StorageService } from '../storage/storage.module';
import { NexoraRealtimeGateway } from './realtime.gateway';
import { AuthenticatedUser, CurrentUser } from '../../common/auth.decorators';

const MODE_SYSTEM_PROMPTS: Record<string, string> = {
  CHAT: 'You are NEXORA AI ("Intelligence Without Limits"), an elite, helpful, accurate multilingual AI assistant fluent in English, Sinhala (සිංහල), Tamil, and major world languages. Format structured answers cleanly with Markdown.',
  CODING:
    'You are NEXORA AI Senior Software Architect & Coding Engineer. Write clean, secure, production-ready code with clear architectural explanations, edge-case handling, and syntax-highlighted code blocks.',
  DOCUMENT:
    'You are NEXORA AI Document Intelligence Analyst. Synthesize, cross-reference, summarize, and answer questions accurately from the user-supplied document context. Cite sections clearly.',
  STUDY:
    'You are NEXORA AI Study & Exam Tutor. Explain concepts clearly step-by-step, offer examples, quizzes, and summaries in English or Sinhala as requested.',
  TRANSLATION:
    'You are NEXORA AI Precision Translator specializing in Sinhala (සිංහල), English, Tamil, and global languages. Preserve nuance, tone, and idioms accurately.',
  VOICE:
    'You are NEXORA AI Voice Assistant. Respond naturally, clearly, and concisely in a conversational spoken style suitable for Text-to-Speech playback in English or Sinhala.',
  PRODUCTIVITY:
    'You are NEXORA AI Executive Productivity Suite. Produce crisp action plans, professional emails, meeting briefs, and structured business deliverables.',
};

@Injectable()
export class ChatService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AiRouterService) private readonly router: AiRouterService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(NexoraRealtimeGateway) private readonly ws: NexoraRealtimeGateway,
  ) {}

  async listModels(category?: string) {
    return this.router.listAvailableModels(category);
  }

  async estimateCost(dto: any) {
    return this.router.estimateOperationCost({
      modelId: dto.modelId,
      taskType: dto.taskType || 'CHAT',
      promptText: dto.prompt || '',
      maxOutputTokens: dto.maxOutputTokens,
      imageCount: dto.imageCount,
      videoDurationSeconds: dto.videoDurationSeconds,
    });
  }

  async createConversation(
    userId: string,
    dto: {
      title?: string;
      mode?: string;
      selectedModelId?: string;
      systemPrompt?: string;
      language?: string;
    },
  ) {
    const mode = dto.mode && MODE_SYSTEM_PROMPTS[dto.mode] ? dto.mode : 'CHAT';
    const res = await this.db.query(
      `INSERT INTO conversations (user_id, title, mode, selected_model_id, system_prompt, language)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        (dto.title || 'New Conversation').trim().slice(0, 200),
        mode,
        dto.selectedModelId || null,
        dto.systemPrompt || null,
        dto.language || 'en',
      ],
    );
    return res.rows[0];
  }

  async listConversations(userId: string, searchQuery?: string, mode?: string) {
    if (searchQuery && searchQuery.trim().length > 0) {
      const pattern = `%${searchQuery.trim()}%`;
      const res = await this.db.query(
        `SELECT DISTINCT c.*
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.user_id = $1
           AND c.is_archived = FALSE
           AND ($2::varchar IS NULL OR c.mode = $2)
           AND (c.title ILIKE $3 OR m.content ILIKE $3)
         ORDER BY c.last_message_at DESC
         LIMIT 60`,
        [userId, mode || null, pattern],
      );
      return res.rows.map((r) => ({ ...r, total_credits_used: Number(r.total_credits_used) }));
    }

    const res = await this.db.query(
      `SELECT * FROM conversations
       WHERE user_id = $1
         AND is_archived = FALSE
         AND ($2::varchar IS NULL OR mode = $2)
       ORDER BY is_pinned DESC, last_message_at DESC
       LIMIT 60`,
      [userId, mode || null],
    );
    return res.rows.map((r) => ({ ...r, total_credits_used: Number(r.total_credits_used) }));
  }

  async getConversationWithMessages(userId: string, conversationId: string) {
    const cRes = await this.db.query(
      'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
      [conversationId, userId],
    );
    if (cRes.rowCount === 0) {
      throw new NotFoundException('Conversation not found');
    }
    const mRes = await this.db.query(
      `SELECT m.*,
              rm.display_name AS requested_model_name,
              em.display_name AS executed_model_name
       FROM messages m
       LEFT JOIN ai_models rm ON rm.id = m.requested_model_id
       LEFT JOIN ai_models em ON em.id = m.executed_model_id
       WHERE m.conversation_id = $1 AND m.user_id = $2
       ORDER BY m.created_at ASC`,
      [conversationId, userId],
    );
    return {
      conversation: {
        ...cRes.rows[0],
        total_credits_used: Number(cRes.rows[0].total_credits_used),
      },
      messages: mRes.rows.map((m) => ({
        ...m,
        credits_charged: Number(m.credits_charged),
      })),
    };
  }

  async renameOrUpdateConversation(
    userId: string,
    conversationId: string,
    dto: { title?: string; isPinned?: boolean; selectedModelId?: string },
  ) {
    const res = await this.db.query(
      `UPDATE conversations
       SET title = COALESCE($1, title),
           is_pinned = COALESCE($2, is_pinned),
           selected_model_id = COALESCE($3, selected_model_id),
           updated_at = NOW()
       WHERE id = $4 AND user_id = $5
       RETURNING *`,
      [
        dto.title?.trim().slice(0, 200) || null,
        dto.isPinned ?? null,
        dto.selectedModelId || null,
        conversationId,
        userId,
      ],
    );
    if (res.rowCount === 0) throw new NotFoundException('Conversation not found');
    return res.rows[0];
  }

  async deleteConversation(userId: string, conversationId: string) {
    const res = await this.db.query(
      'DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id',
      [conversationId, userId],
    );
    if (res.rowCount === 0) throw new NotFoundException('Conversation not found');
    return { deleted: true, id: conversationId };
  }

  /**
   * Sends a message inside a conversation (supports attachments, image vision, Sinhala, streaming callback).
   */
  async sendMessage(params: {
    userId: string;
    userRole: string;
    conversationId: string;
    content: string;
    modelId?: string;
    attachmentFileIds?: string[];
    allowFallback?: boolean;
    idempotencyKey?: string;
    ipAddress?: string;
    onTokenDelta?: (delta: string) => void;
  }) {
    if (!params.content || !params.content.trim()) {
      throw new BadRequestException('Message content cannot be empty');
    }

    const convData = await this.getConversationWithMessages(params.userId, params.conversationId);
    const conv = convData.conversation;
    const requestedModelId = params.modelId || conv.selected_model_id || undefined;

    // Resolve attachments (document text or image base64 for multimodal vision)
    let enrichedUserContent = params.content.trim();
    let imageMimeType: string | undefined;
    let imageBase64: string | undefined;
    const attachmentsMeta: any[] = [];

    if (params.attachmentFileIds && params.attachmentFileIds.length > 0) {
      for (const fileId of params.attachmentFileIds) {
        const file = await this.storage.getFileForUser(params.userId, fileId);
        attachmentsMeta.push({
          fileId: file.id,
          filename: file.originalFilename,
          mimeType: file.mimeType,
        });
        if (file.mimeType.startsWith('image/')) {
          imageMimeType = file.mimeType;
          imageBase64 = file.buffer.toString('base64');
        } else if (file.extractedText) {
          enrichedUserContent += `\n\n--- Attached Document (${file.originalFilename}) ---\n${file.extractedText.slice(0, 24000)}\n--- End Document ---`;
        }
      }
    }

    // Persist user message immediately
    const userMsgIns = await this.db.query<{ id: string; created_at: string }>(
      `INSERT INTO messages (conversation_id, user_id, role, content, requested_model_id, attachments)
       VALUES ($1, $2, 'user', $3, $4, $5)
       RETURNING id, created_at`,
      [
        conv.id,
        params.userId,
        params.content.trim(),
        requestedModelId || null,
        JSON.stringify(attachmentsMeta),
      ],
    );

    // Assemble context window history (last 18 turns)
    const systemPrompt =
      conv.system_prompt ||
      MODE_SYSTEM_PROMPTS[conv.mode] ||
      MODE_SYSTEM_PROMPTS.CHAT;
    const langInstruction =
      conv.language === 'si'
        ? '\nRespond naturally in Sinhala (සිංහල) unless the user asks for another language.'
        : '';

    const contextMessages: ChatTurnMessage[] = [
      { role: 'system', content: systemPrompt + langInstruction },
      ...convData.messages.slice(-18).map((m: any) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      {
        role: 'user',
        content: enrichedUserContent,
        imageMimeType,
        imageBase64,
      },
    ];

    const idemKey =
      params.idempotencyKey || `chat:${params.userId}:${userMsgIns.rows[0].id}:${crypto.randomUUID().slice(0, 8)}`;

    const routed = await this.router.routeAndExecuteChat({
      userId: params.userId,
      userRole: params.userRole,
      requestedModelId,
      taskType: conv.mode,
      messages: contextMessages,
      allowFallback: params.allowFallback,
      idempotencyKey: idemKey,
      conversationId: conv.id,
      ipAddress: params.ipAddress,
      onTokenDelta: (delta) => {
        params.onTokenDelta?.(delta);
        this.ws.emitToUser(params.userId, 'chat:delta', {
          conversationId: conv.id,
          delta,
        });
      },
    });

    // Save assistant message
    const asstIns = await this.db.query<{ id: string; created_at: string }>(
      `INSERT INTO messages (
         conversation_id, user_id, role, content,
         requested_model_id, executed_model_id, fallback_used, fallback_reason,
         input_tokens, output_tokens, credits_charged, parent_message_id, latency_ms
       ) VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, created_at`,
      [
        conv.id,
        params.userId,
        routed.content,
        routed.requestedModel.id,
        routed.executedModel.id,
        routed.fallbackUsed,
        routed.fallbackNotice?.reason || null,
        routed.usage.inputTokens,
        routed.usage.outputTokens,
        routed.usage.creditsCharged,
        userMsgIns.rows[0].id,
        routed.usage.latencyMs,
      ],
    );

    // Auto-title conversation on first turn
    const autoTitle =
      conv.message_count === 0 && conv.title === 'New Conversation'
        ? params.content.trim().slice(0, 60)
        : conv.title;

    await this.db.query(
      `UPDATE conversations
       SET title = $1,
           selected_model_id = COALESCE(selected_model_id, $2),
           message_count = message_count + 2,
           total_credits_used = total_credits_used + $3,
           last_message_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [autoTitle, routed.executedModel.id, routed.usage.creditsCharged, conv.id],
    );

    return {
      conversationId: conv.id,
      conversationTitle: autoTitle,
      userMessage: {
        id: userMsgIns.rows[0].id,
        role: 'user',
        content: params.content.trim(),
        createdAt: userMsgIns.rows[0].created_at,
      },
      assistantMessage: {
        id: asstIns.rows[0].id,
        role: 'assistant',
        content: routed.content,
        requestedModel: routed.requestedModel,
        executedModel: routed.executedModel,
        fallbackUsed: routed.fallbackUsed,
        fallbackNotice: routed.fallbackNotice,
        usage: routed.usage,
        createdAt: asstIns.rows[0].created_at,
      },
    };
  }

  /**
   * Edits an existing user message and optionally regenerates the response.
   */
  async editUserMessage(
    userId: string,
    userRole: string,
    messageId: string,
    newContent: string,
    regenerate = true,
  ) {
    const mRes = await this.db.query<{ id: string; conversation_id: string; role: string }>(
      'SELECT id, conversation_id, role FROM messages WHERE id = $1 AND user_id = $2',
      [messageId, userId],
    );
    if (mRes.rowCount === 0) throw new NotFoundException('Message not found');
    if (mRes.rows[0].role !== 'user') {
      throw new BadRequestException('Only user messages can be edited');
    }

    await this.db.query(
      'UPDATE messages SET content = $1, is_edited = TRUE, updated_at = NOW() WHERE id = $2',
      [newContent.trim(), messageId],
    );

    if (!regenerate) {
      return { updated: true, messageId };
    }
    return this.regenerateLastAssistantReply(userId, userRole, mRes.rows[0].conversation_id);
  }

  /**
   * Regenerates the latest assistant reply in a conversation.
   */
  async regenerateLastAssistantReply(
    userId: string,
    userRole: string,
    conversationId: string,
    modelId?: string,
  ) {
    const convData = await this.getConversationWithMessages(userId, conversationId);
    const msgs = convData.messages;
    const lastUserIdx = [...msgs].map((m: any) => m.role).lastIndexOf('user');
    if (lastUserIdx === -1) {
      throw new BadRequestException('No user prompt found to regenerate');
    }
    const targetUserMsg = msgs[lastUserIdx];

    // Remove trailing assistant reply after lastUserIdx if present
    if (lastUserIdx < msgs.length - 1) {
      const trailingIds = msgs.slice(lastUserIdx + 1).map((m: any) => m.id);
      for (const tid of trailingIds) {
        await this.db.query('DELETE FROM messages WHERE id = $1 AND user_id = $2', [tid, userId]);
      }
    }

    const systemPrompt =
      convData.conversation.system_prompt ||
      MODE_SYSTEM_PROMPTS[convData.conversation.mode] ||
      MODE_SYSTEM_PROMPTS.CHAT;

    const historyUpToPrompt: ChatTurnMessage[] = [
      { role: 'system', content: systemPrompt },
      ...msgs.slice(0, lastUserIdx + 1).map((m: any) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ];

    const routed = await this.router.routeAndExecuteChat({
      userId,
      userRole,
      requestedModelId: modelId || convData.conversation.selected_model_id || undefined,
      taskType: convData.conversation.mode,
      messages: historyUpToPrompt,
      idempotencyKey: `regen:${conversationId}:${Date.now()}`,
      conversationId,
    });

    const asstIns = await this.db.query<{ id: string; created_at: string }>(
      `INSERT INTO messages (
         conversation_id, user_id, role, content,
         requested_model_id, executed_model_id, fallback_used, fallback_reason,
         input_tokens, output_tokens, credits_charged, parent_message_id, latency_ms
       ) VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, created_at`,
      [
        conversationId,
        userId,
        routed.content,
        routed.requestedModel.id,
        routed.executedModel.id,
        routed.fallbackUsed,
        routed.fallbackNotice?.reason || null,
        routed.usage.inputTokens,
        routed.usage.outputTokens,
        routed.usage.creditsCharged,
        targetUserMsg.id,
        routed.usage.latencyMs,
      ],
    );

    await this.db.query(
      `UPDATE conversations
       SET total_credits_used = total_credits_used + $1,
           last_message_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [routed.usage.creditsCharged, conversationId],
    );

    return {
      conversationId,
      assistantMessage: {
        id: asstIns.rows[0].id,
        role: 'assistant',
        content: routed.content,
        requestedModel: routed.requestedModel,
        executedModel: routed.executedModel,
        fallbackUsed: routed.fallbackUsed,
        fallbackNotice: routed.fallbackNotice,
        usage: routed.usage,
        createdAt: asstIns.rows[0].created_at,
      },
    };
  }

  /**
   * Stateless/One-shot AI tool execution (used by AI Coding, Translation, Study, Document Analysis, Voice & Business API).
   */
  async executeToolPrompt(params: {
    userId: string;
    userRole: string;
    mode: string;
    prompt: string;
    modelId?: string;
    targetLanguage?: string;
    fileId?: string;
    allowFallback?: boolean;
    ipAddress?: string;
  }) {
    const conv = await this.createConversation(params.userId, {
      title: `${params.mode}: ${params.prompt.slice(0, 48)}`,
      mode: params.mode,
      selectedModelId: params.modelId,
      language: params.targetLanguage === 'si' ? 'si' : 'en',
    });

    const formattedPrompt = params.targetLanguage
      ? `[Target Language: ${params.targetLanguage}]\n\n${params.prompt}`
      : params.prompt;

    return this.sendMessage({
      userId: params.userId,
      userRole: params.userRole,
      conversationId: conv.id,
      content: formattedPrompt,
      modelId: params.modelId,
      attachmentFileIds: params.fileId ? [params.fileId] : undefined,
      allowFallback: params.allowFallback,
      ipAddress: params.ipAddress,
    });
  }
}

@ApiTags('AI Models, Chat, Streaming, Coding, Docs, Voice & Tools')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(@Inject(ChatService) private readonly chatService: ChatService) {}

  @Get('models')
  @ApiOperation({ summary: 'List dynamic AI models with live provider & capability availability' })
  async listModels(@Query('category') category?: string) {
    return this.chatService.listModels(category);
  }

  @Post('estimate')
  @ApiOperation({ summary: 'Estimate token credit cost before sending an AI request' })
  async estimate(@Body() body: any) {
    return this.chatService.estimateCost(body);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List or search user conversations (isolated per user)' })
  async listConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('mode') mode?: string,
  ) {
    return this.chatService.listConversations(user.id, q, mode);
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Create a new AI conversation (Chat, Coding, Document, Study, Voice)' })
  async createConversation(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.chatService.createConversation(user.id, body || {});
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get conversation messages & credit metadata' })
  async getConversation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.chatService.getConversationWithMessages(user.id, id);
  }

  @Patch('conversations/:id')
  @ApiOperation({ summary: 'Rename, pin, or change default model of a conversation' })
  async updateConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.chatService.renameOrUpdateConversation(user.id, id, body || {});
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Delete conversation and cascade messages' })
  async deleteConversation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.chatService.deleteConversation(user.id, id);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send a message and receive full routed AI response with credit settlement' })
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
    return this.chatService.sendMessage({
      userId: user.id,
      userRole: user.role,
      conversationId: id,
      content: body?.content,
      modelId: body?.modelId,
      attachmentFileIds: body?.attachmentFileIds,
      allowFallback: body?.allowFallback,
      idempotencyKey: body?.idempotencyKey,
      ipAddress: ip,
    });
  }

  @Post('conversations/:id/stream')
  @ApiOperation({ summary: 'Stream AI response tokens via Server-Sent Events (SSE)' })
  async streamMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
    @Res() res: any,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';

    try {
      const completed = await this.chatService.sendMessage({
        userId: user.id,
        userRole: user.role,
        conversationId: id,
        content: body?.content,
        modelId: body?.modelId,
        attachmentFileIds: body?.attachmentFileIds,
        allowFallback: body?.allowFallback,
        idempotencyKey: body?.idempotencyKey,
        ipAddress: ip,
        onTokenDelta: (delta) => {
          res.write(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`);
        },
      });
      res.write(`event: completed\ndata: ${JSON.stringify(completed)}\n\n`);
      res.end();
    } catch (err: any) {
      const payload = err?.getResponse ? err.getResponse() : { message: err?.message || 'Stream error' };
      res.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
      res.end();
    }
  }

  @Patch('messages/:messageId')
  @ApiOperation({ summary: 'Edit a user message and regenerate assistant response' })
  async editMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body() body: { content: string; regenerate?: boolean },
  ) {
    return this.chatService.editUserMessage(
      user.id,
      user.role,
      messageId,
      body?.content,
      body?.regenerate !== false,
    );
  }

  @Post('conversations/:id/regenerate')
  @ApiOperation({ summary: 'Regenerate the latest assistant response' })
  async regenerate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body?: { modelId?: string },
  ) {
    return this.chatService.regenerateLastAssistantReply(user.id, user.role, id, body?.modelId);
  }

  @Post('tools/execute')
  @ApiOperation({
    summary:
      'Execute specialized AI tool (CODING, DOCUMENT, TRANSLATION, STUDY, VOICE, PRODUCTIVITY) or Business API call',
  })
  async executeTool(@CurrentUser() user: AuthenticatedUser, @Body() body: any, @Req() req: any) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
    return this.chatService.executeToolPrompt({
      userId: user.id,
      userRole: user.role,
      mode: body?.mode || 'CHAT',
      prompt: body?.prompt,
      modelId: body?.modelId,
      targetLanguage: body?.targetLanguage,
      fileId: body?.fileId,
      allowFallback: body?.allowFallback,
      ipAddress: ip,
    });
  }
}

@Module({
  imports: [StorageModule],
  providers: [NexoraRealtimeGateway, ChatService],
  controllers: [ChatController],
  exports: [NexoraRealtimeGateway, ChatService],
})
export class ChatModule {}
