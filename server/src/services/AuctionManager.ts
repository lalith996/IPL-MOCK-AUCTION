import { Server, Socket } from 'socket.io';
import AuctionRoom, { IAuctionRoom } from '../models/AuctionRoom';
import Player, { IPlayer } from '../models/Player';
import Team, { ITeam } from '../models/Team';
import mongoose from 'mongoose';

interface AuctionState {
    roomId: string;
    timer: NodeJS.Timeout | null;
    timeLeft: number;
}

export class AuctionManager {
    private io: Server;
    private activeAuctions: Map<string, AuctionState>;
    private readonly BID_TIMER_SECONDS = 15;

    constructor(io: Server) {
        this.io = io;
        this.activeAuctions = new Map();
    }

    public async startAuction(roomId: string) {
        const room = await AuctionRoom.findById(roomId).populate('unsoldPlayers');
        if (!room || room.status === 'COMPLETED') return;

        room.status = 'ONGOING';
        await room.save();

        this.io.to(roomId).emit('auction_started', { message: 'Auction Starting!' });
        this.nextPlayer(roomId);
    }

    private async nextPlayer(roomId: string) {
        const room = await AuctionRoom.findById(roomId).populate('unsoldPlayers');
        if (!room) return;

        if (room.unsoldPlayers.length === 0) {
            this.endAuction(roomId, room);
            return;
        }

        // Pick random next player
        const nextPlayerIndex = Math.floor(Math.random() * room.unsoldPlayers.length);
        const player = room.unsoldPlayers[nextPlayerIndex] as unknown as IPlayer; // Cast due to populate

        // Update Room State
        room.currentPlayer = player._id as any;
        room.currentBid = player.basePrice;
        room.currentBidder = null;

        // Move player from unsold to pending (conceptually, distinct from 'sold')
        // For simplicity, we keep in unsold until sold.

        await room.save();

        // Broadcast new player
        this.io.to(roomId).emit('new_player', {
            player: player,
            currentBid: room.currentBid,
            timeLeft: this.BID_TIMER_SECONDS
        });

        this.startTimer(roomId);
    }

    private startTimer(roomId: string) {
        // Clear existing timer if any
        const existing = this.activeAuctions.get(roomId);
        if (existing?.timer) clearInterval(existing.timer);

        let timeLeft = this.BID_TIMER_SECONDS;

        const timer = setInterval(async () => {
            timeLeft--;
            // Optimize: Don't emit every second in prod, maybe every 5 or last 3
            this.io.to(roomId).emit('timer_update', { timeLeft });

            if (timeLeft <= 0) {
                clearInterval(timer);
                await this.handleTimerExpiry(roomId);
            }
        }, 1000);

        this.activeAuctions.set(roomId, { roomId, timer, timeLeft });
    }

    private async handleTimerExpiry(roomId: string) {
        const room = await AuctionRoom.findById(roomId);
        if (!room || !room.currentPlayer) return;

        if (room.currentBidder) {
            // SOLD!
            await this.sellPlayer(room);
        } else {
            // UNSOLD
            this.io.to(roomId).emit('player_unsold', { playerId: room.currentPlayer });
            // Logic to move to back of queue could go here
        }

        // Delay before next player
        setTimeout(() => this.nextPlayer(roomId), 5000);
    }

    private async sellPlayer(room: IAuctionRoom) {
        const player = await Player.findById(room.currentPlayer);
        const team = await Team.findById(room.currentBidder);

        if (player && team) {
            // Update Player
            player.isSold = true;
            player.soldTo = team._id as any;
            player.soldPrice = room.currentBid;
            await player.save();

            // Update Team
            team.budget -= room.currentBid;
            team.players.push(player._id as any);
            await team.save();

            // Update Room
            room.soldPlayers.push(player._id as any);
            room.unsoldPlayers = room.unsoldPlayers.filter(p => !p.equals(player._id as any));
            room.bidHistory.push({
                teamId: team._id as any,
                amount: room.currentBid,
                timestamp: new Date()
            });
            await room.save();

            this.io.to(room.roomCode).emit('player_sold', {
                player: player,
                soldTo: team,
                price: room.currentBid
            });
        }
    }

    public async placeBid(roomId: string, teamId: string, amount: number): Promise<boolean> {
        const room = await AuctionRoom.findOne({ roomCode: roomId }); // Note: roomId argument might be roomCode or _id, unifying to roomCode for socket rooms usually
        if (!room || !room.currentPlayer || room.status !== 'ONGOING') return false;

        // Validation
        if (amount <= room.currentBid) return false;

        const team = await Team.findById(teamId);
        if (!team || team.budget < amount) return false;

        // Accept Bid
        room.currentBid = amount;
        room.currentBidder = team._id as any;
        await room.save();

        // Reset Timer
        this.startTimer(roomId); // "Going once, going twice..." reset

        // Broadcast
        this.io.to(roomId).emit('bid_update', {
            amount: room.currentBid,
            teamId: team._id,
            teamName: team.name
        });

        return true;
    }

    private endAuction(roomId: string, room: IAuctionRoom) {
        room.status = 'COMPLETED';
        room.save();
        this.io.to(roomId).emit('auction_ended', { results: room.soldPlayers });
    }
}
