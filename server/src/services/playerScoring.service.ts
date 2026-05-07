import { IPlayerStats } from '../models/Player';

export class PlayerScoringService {
    /**
     * Calculates a "Form Score" (0-100) based on recent performance metrics.
     * This is a simplified heuristic.
     */
    public static calculateFormScore(stats: IPlayerStats): number {
        let score = 50;

        // Batting contribution
        if (stats.innings > 0) {
            const avgFactor = Math.min(stats.average / 50, 1) * 20; // Max 20 points
            const srFactor = Math.min(stats.strikeRate / 150, 1) * 20; // Max 20 points
            score += avgFactor + srFactor;
        }

        // Bowling contribution
        if (stats.wickets > 0) {
            const wktFactor = Math.min(stats.wickets / 20, 1) * 20; // Max 20 points
            const ecoFactor = Math.max(0, (10 - stats.economy)) * 2; // Better economy = more points
            score += wktFactor + ecoFactor;
        }

        return Math.min(100, Math.round(score));
    }

    /**
     * Calculates "Market Value" score (0-100) for AI bidding logic.
     */
    public static calculateValueScore(stats: IPlayerStats, role: string): number {
        let value = 40; // Base value

        if (role === 'Batsman' || role === 'Wicketkeeper') {
            value += (stats.average * 0.5) + (stats.strikeRate * 0.2);
        } else if (role === 'Bowler') {
            value += (stats.wickets * 1.5) + ((10 - stats.economy) * 5);
        } else if (role === 'All-Rounder') {
            value += (stats.average * 0.3) + (stats.wickets * 1.0) + (stats.strikeRate * 0.1);
        }

        return Math.min(100, Math.round(value));
    }

    /**
     * Generates a "Base Price" based on tier and stats.
     * Returns price in INR (e.g., 20000000 = 2 Crore).
     */
    public static calculateBasePrice(stats: IPlayerStats, role: string): number {
        const valueScore = this.calculateValueScore(stats, role);

        if (valueScore > 85) return 20000000; // 2 Cr
        if (valueScore > 75) return 15000000; // 1.5 Cr
        if (valueScore > 65) return 10000000; // 1 Cr
        if (valueScore > 50) return 5000000;  // 50 L
        if (valueScore > 30) return 3000000;  // 30 L
        return 2000000;                       // 20 L
    }
}
