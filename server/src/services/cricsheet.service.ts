import fs from 'fs';
import path from 'path';
import { IPlayerStats } from '../models/Player';
import { PlayerScoringService } from './playerScoring.service';

interface CricsheetMatch {
    info: {
        dates: string[];
        player_of_match?: string[];
        teams: string[];
    };
    innings: Array<{
        team: string;
        overs: Array<{
            over: number;
            deliveries: Array<{
                batter: string;
                bowler: string;
                runs: { batter: number; total: number; extras: number };
                wickets?: Array<{ kind: string; player_out: string }>;
            }>;
        }>;
    }>;
}

export class CricsheetService {
    private jsonDir: string;
    private players: Map<string, { stats: IPlayerStats, role: Set<string> }>;

    constructor(jsonDir: string) {
        this.jsonDir = jsonDir;
        this.players = new Map();
    }

    public async processAllFiles() {
        console.log('Starting Cricsheet processing from:', this.jsonDir);

        try {
            const files = fs.readdirSync(this.jsonDir).filter(f => f.endsWith('.json'));
            console.log(`Found ${files.length} match files.`);

            let processedCount = 0;
            for (const file of files) {
                if (processedCount >= 50) break; // LIMIT FOR DEMO SPEED - REMOVE FOR FULL PROCESS
                const content = fs.readFileSync(path.join(this.jsonDir, file), 'utf-8');
                const matchData: CricsheetMatch = JSON.parse(content);
                this.processMatch(matchData);
                processedCount++;
                if (processedCount % 10 === 0) console.log(`Processed ${processedCount} matches...`);
            }

            return this.convertMapToPlayerObjects();
        } catch (error) {
            console.error('Error processing Cricsheet files:', error);
            throw error;
        }
    }

    private processMatch(match: CricsheetMatch) {
        for (const inning of match.innings || []) {
            for (const over of inning.overs || []) {
                for (const delivery of over.deliveries || []) {
                    // Batting Stats
                    this.updateBattingStats(delivery.batter, delivery.runs.batter);

                    // Bowling Stats
                    this.updateBowlingStats(delivery.bowler, delivery.runs.total, delivery.wickets);
                }
            }
        }
    }

    private getPlayerEntry(name: string) {
        if (!this.players.has(name)) {
            this.players.set(name, {
                role: new Set(),
                stats: {
                    matches: 0, innings: 0, runs: 0, ballsFaced: 0, average: 0, strikeRate: 0,
                    hundreds: 0, fifties: 0, fours: 0, sixes: 0, wickets: 0, economy: 0,
                    bowlingAverage: 0, bowlingStrikeRate: 0
                }
            });
        }
        return this.players.get(name)!;
    }

    private updateBattingStats(name: string, runs: number) {
        const p = this.getPlayerEntry(name);
        p.role.add('Batsman');
        p.stats.runs += runs;
        p.stats.ballsFaced += 1;
        if (runs === 4) p.stats.fours++;
        if (runs === 6) p.stats.sixes++;
        // Note: Innings/Matches logic is simplified here; usually tracked by unique match IDs
    }

    private updateBowlingStats(name: string, runsConceded: number, wickets?: any[]) {
        const p = this.getPlayerEntry(name);
        p.role.add('Bowler');
        // Economy tracking simplified (needs balls bowled tracking)
        if (wickets && wickets.length > 0) {
            for (const w of wickets) {
                if (w.kind !== 'run out') p.stats.wickets++;
            }
        }
    }

    private convertMapToPlayerObjects() {
        const playerList: any[] = [];

        for (const [name, data] of this.players.entries()) {
            // Calculate derived stats
            if (data.stats.ballsFaced > 0) {
                data.stats.strikeRate = (data.stats.runs / data.stats.ballsFaced) * 100;
            }
            // Simple Average approximation (Runouts/Not outs ignored for simplicity in this demo)
            data.stats.average = data.stats.runs / (data.stats.innings || 1);

            // Determine Role
            let role = 'Batsman';
            if (data.role.has('Bowler') && data.stats.wickets > 10) role = 'Bowler';
            if (data.role.has('Batsman') && data.role.has('Bowler') && data.stats.runs > 500 && data.stats.wickets > 10) role = 'All-Rounder';
            if (name.includes('Dhoni') || name.includes('Pant')) role = 'Wicketkeeper'; // Simple heuristic override

            // Scores
            const formScore = PlayerScoringService.calculateFormScore(data.stats);
            const valueScore = PlayerScoringService.calculateValueScore(data.stats, role);
            const basePrice = PlayerScoringService.calculateBasePrice(data.stats, role);

            playerList.push({
                name,
                role,
                stats: data.stats,
                basePrice,
                cricsheetId: name.toLowerCase().replace(/ /g, '_'), // specific ID gen
                formScore,
                valueScore,
                buzzScore: Math.floor(Math.random() * 40) + 30 // Random buzz 30-70 initially
            });
        }

        // Filter out very minor players (noise in dataset)
        return playerList.filter(p => p.stats.runs > 50 || p.stats.wickets > 5);
    }
}
