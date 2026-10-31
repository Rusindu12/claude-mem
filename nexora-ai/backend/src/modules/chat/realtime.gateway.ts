import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/ws',
})
@Injectable()
export class NexoraRealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NexoraRealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(@Inject(JwtService) private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const rawToken =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      if (!rawToken) {
        client.disconnect();
        return;
      }
      const payload = await this.jwtService.verifyAsync(rawToken, {
        secret: process.env.JWT_ACCESS_SECRET || 'nexora-dev-jwt-access-secret-change-in-prod!',
      });
      client.data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    client.emit('pong', { ts: Date.now(), echo: data });
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    if (this.server) {
      this.server.to(`user:${userId}`).emit(event, payload);
    }
  }
}
