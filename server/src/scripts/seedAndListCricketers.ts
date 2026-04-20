import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';
import Player from '../models/Player';
import { connectDB } from '../config/db';

dotenv.config();

interface CricsheetMatch {
    info?: {
        registry?: {
            people?: { [key: string]: string };
        };
        players?: { [team: string]: string[] };
    };
    innings?: Array<{
        team: string;
        overs: Array<{
            over: number;
            deliveries: Array<{
                batter: string;
                bowler: string;
                runs: { batter: number; total: number };
                wickets?: Array<{ kind: string; player_out: string }>;
            }>;
        }>;
    }>;
}

interface PlayerData {
    name: string;
    cricsheetId: string;
    battingStats: {
        runs: number;
        ballsFaced: number;
        fours: number;
        sixes: number;
        innings: number;
    };
    bowlingStats: {
        wickets: number;
        ballsBowled: number;
        runsConceded: number;
    };
    matches: Set<string>;
}

const seedAndListCricketers = async () => {
    try {
        console.log('🏏 Starting Cricket Database Seed...\n');
        await connectDB();

        // Clear existing data
        console.log('🧹 Clearing existing players...');
        await Player.deleteMany({});
        console.log('✅ Cleared existing data\n');

        // Process all JSON directories
        const jsonDirs = [
            'ipl_json',
            'all_male_json',
            't20s_male_json',
            'odis_male_json',
            'tests_male_json'
        ];

        const playersMap = new Map<string, PlayerData>();
        let totalFilesProcessed = 0;

        for (const dirName of jsonDirs) {
            const jsonDir = path.join(__dirname, '../../../', dirName);
            
            if (!fs.existsSync(jsonDir)) {
                console.log(`⚠️  Directory not found: ${dirName}, skipping...`);
                continue;
            }

            const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));
            console.log(`📁 Processing ${dirName}: ${files.length} files`);

            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(jsonDir, file), 'utf-8');
                    const matchData: CricsheetMatch = JSON.parse(content);
                    
                    processMatchData(matchData, playersMap, file);
                    totalFilesProcessed++;
                    
                    if (totalFilesProcessed % 100 === 0) {
                        console.log(`   Processed ${totalFilesProcessed} matches...`);
                    }
                } catch (error) {
                    // Skip files with errors
                    continue;
                }
            }
        }

        console.log(`\n✅ Processed ${totalFilesProcessed} match files`);
        console.log(`👥 Found ${playersMap.size} unique players\n`);

        // Convert map to player documents
        const players = Array.from(playersMap.values()).map(playerData => {
            const role = determineRole(playerData);
            const stats = calculateStats(playerData);
            
            return {
                name: playerData.name,
                role: role,
                stats: stats,
                basePrice: calculateBasePrice(stats, role),
                cricsheetId: playerData.cricsheetId,
                isSold: false,
                formScore: 50,
                buzzScore: 50,
                valueScore: 50,
                tier: determineTier(stats, role)
            };
        });

        // Insert into database
        console.log('💾 Inserting players into MongoDB...');
        await Player.insertMany(players);
        console.log('✅ Successfully inserted all players!\n');

        // List all cricketers
        console.log('📋 LISTING ALL CRICKETERS IN DATABASE:\n');
        console.log('=' .repeat(80));
        
        const allPlayers = await Player.find({}).sort({ name: 1 });
        
        console.log(`\nTotal Cricketers: ${allPlayers.length}\n`);
        
        // Group by role
        const roleGroups: { [key: string]: typeof allPlayers } = {
            'Batsman': [],
            'Bowler': [],
            'All-Rounder': [],
            'Wicketkeeper': []
        };

        allPlayers.forEach(player => {
            if (roleGroups[player.role]) {
                roleGroups[player.role].push(player);
            }
        });

        // Display by role
        for (const [role, players] of Object.entries(roleGroups)) {
            if (players.length > 0) {
                console.log(`\n${role.toUpperCase()} (${players.length}):`);
                console.log('-'.repeat(80));
                players.forEach((player, index) => {
                    console.log(`${(index + 1).toString().padStart(4)}. ${player.name.padEnd(35)} | ` +
                        `Runs: ${player.stats.runs.toString().padStart(6)} | ` +
                        `Wickets: ${player.stats.wickets.toString().padStart(4)} | ` +
                        `Tier: ${player.tier}`);
                });
            }
        }

        console.log('\n' + '='.repeat(80));
        
        // Summary statistics
        console.log('\n📊 SUMMARY STATISTICS:');
        console.log(`   Batsmen: ${roleGroups['Batsman'].length}`);
        console.log(`   Bowlers: ${roleGroups['Bowler'].length}`);
        console.log(`   All-Rounders: ${roleGroups['All-Rounder'].length}`);
        console.log(`   Wicketkeepers: ${roleGroups['Wicketkeeper'].length}`);
        console.log(`   Total: ${allPlayers.length}`);

        console.log('\n✅ Database seeding and listing completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

function processMatchData(
    matchData: CricsheetMatch,
    playersMap: Map<string, PlayerData>,
    fileName: string
) {
    // Extract player registry
    const registry = matchData.info?.registry?.people || {};
    const teams = matchData.info?.players || {};

    // Register all players from teams
    for (const [teamName, playerNames] of Object.entries(teams)) {
        for (const playerName of playerNames) {
            const cricsheetId = registry[playerName] || playerName;
            
            if (!playersMap.has(cricsheetId)) {
                playersMap.set(cricsheetId, {
                    name: playerName,
                    cricsheetId: cricsheetId,
                    battingStats: { runs: 0, ballsFaced: 0, fours: 0, sixes: 0, innings: 0 },
                    bowlingStats: { wickets: 0, ballsBowled: 0, runsConceded: 0 },
                    matches: new Set()
                });
            }
            playersMap.get(cricsheetId)!.matches.add(fileName);
        }
    }

    // Process innings data
    if (matchData.innings) {
        for (const inning of matchData.innings) {
            const battersInInning = new Set<string>();
            
            for (const over of inning.overs || []) {
                for (const delivery of over.deliveries || []) {
                    // Batting stats
                    const batterId = registry[delivery.batter] || delivery.batter;
                    const batterData = playersMap.get(batterId);
                    
                    if (batterData) {
                        batterData.battingStats.runs += delivery.runs.batter;
                        batterData.battingStats.ballsFaced += 1;
                        
                        if (delivery.runs.batter === 4) batterData.battingStats.fours++;
                        if (delivery.runs.batter === 6) batterData.battingStats.sixes++;
                        
                        battersInInning.add(batterId);
                    }

                    // Bowling stats
                    const bowlerId = registry[delivery.bowler] || delivery.bowler;
                    const bowlerData = playersMap.get(bowlerId);
                    
                    if (bowlerData) {
                        bowlerData.bowlingStats.ballsBowled += 1;
                        bowlerData.bowlingStats.runsConceded += delivery.runs.total;
                        
                        if (delivery.wickets && delivery.wickets.length > 0) {
                            bowlerData.bowlingStats.wickets += delivery.wickets.length;
                        }
                    }
                }
            }
            
            // Count innings for batters who faced at least one ball
            battersInInning.forEach(batterId => {
                const data = playersMap.get(batterId);
                if (data) data.battingStats.innings += 1;
            });
        }
    }
}

function determineRole(playerData: PlayerData): 'Batsman' | 'Bowler' | 'All-Rounder' | 'Wicketkeeper' {
    const hasSignificantBatting = playerData.battingStats.runs > 100 || playerData.battingStats.innings > 5;
    const hasSignificantBowling = playerData.bowlingStats.wickets > 5 || playerData.bowlingStats.ballsBowled > 100;

    if (hasSignificantBatting && hasSignificantBowling) {
        return 'All-Rounder';
    } else if (hasSignificantBowling) {
        return 'Bowler';
    } else if (hasSignificantBatting) {
        return 'Batsman';
    } else {
        // Default based on which they did more
        return playerData.battingStats.ballsFaced >= playerData.bowlingStats.ballsBowled 
            ? 'Batsman' 
            : 'Bowler';
    }
}

function calculateStats(playerData: PlayerData) {
    const batting = playerData.battingStats;
    const bowling = playerData.bowlingStats;
    
    const average = batting.innings > 0 ? batting.runs / batting.innings : 0;
    const strikeRate = batting.ballsFaced > 0 ? (batting.runs / batting.ballsFaced) * 100 : 0;
    const economy = bowling.ballsBowled > 0 ? (bowling.runsConceded / bowling.ballsBowled) * 6 : 0;
    const bowlingAverage = bowling.wickets > 0 ? bowling.runsConceded / bowling.wickets : 0;
    const bowlingStrikeRate = bowling.wickets > 0 ? bowling.ballsBowled / bowling.wickets : 0;

    return {
        matches: playerData.matches.size,
        innings: batting.innings,
        runs: batting.runs,
        ballsFaced: batting.ballsFaced,
        average: Math.round(average * 100) / 100,
        strikeRate: Math.round(strikeRate * 100) / 100,
        hundreds: Math.floor(batting.runs / 100),
        fifties: Math.floor(batting.runs / 50),
        fours: batting.fours,
        sixes: batting.sixes,
        wickets: bowling.wickets,
        economy: Math.round(economy * 100) / 100,
        bowlingAverage: Math.round(bowlingAverage * 100) / 100,
        bowlingStrikeRate: Math.round(bowlingStrikeRate * 100) / 100
    };
}

function calculateBasePrice(stats: any, role: string): number {
    let price = 20; // Base minimum (in lakhs)
    
    // Add based on stats
    price += Math.min(stats.runs / 100, 50);
    price += Math.min(stats.wickets * 2, 30);
    price += Math.min(stats.matches * 0.5, 20);
    
    return Math.round(price * 10) / 10;
}

function determineTier(stats: any, role: string): string {
    const totalImpact = stats.runs + (stats.wickets * 20) + (stats.matches * 5);
    
    if (totalImpact > 3000) return 'Marquee';
    if (role === 'All-Rounder' && stats.runs > 500 && stats.wickets > 20) return 'All-Rounder';
    if (role === 'Wicketkeeper') return 'Wicketkeeper';
    if (role === 'Bowler') return 'Bowler';
    if (role === 'Batsman') return 'Batter';
    return 'Uncapped';
}

// Run the script
seedAndListCricketers();
