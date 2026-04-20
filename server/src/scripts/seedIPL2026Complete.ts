import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Player from '../models/Player';
import { connectDB } from '../config/db';

dotenv.config();

// Full Retained Players (173 total from IPLT20)
const retainedPlayers = [
  // CSK (16)
  { name: 'Anshul Kamboj', role: 'AR', status: 'retained', team: 'CSK', price: 4.00, country: 'India' },
  { name: 'Gurjapneet Singh', role: 'BOWL', status: 'retained', team: 'CSK', price: 2.40, country: 'India' },
  { name: 'Jamie Overton', role: 'AR', status: 'retained', team: 'CSK', price: 5.50, country: 'England' },
  { name: 'MS Dhoni', role: 'WK', status: 'retained', team: 'CSK', price: 4.00, country: 'India' },
  { name: 'Mukesh Choudhary', role: 'BOWL', status: 'retained', team: 'CSK', price: 0.30, country: 'India' },
  { name: 'Nathan Ellis', role: 'BOWL', status: 'retained', team: 'CSK', price: 2.00, country: 'Australia' },
  { name: 'Noor Ahmad', role: 'BOWL', status: 'retained', team: 'CSK', price: 3.00, country: 'Afghanistan' },
  { name: 'Ramakrishna Ghosh', role: 'BAT', status: 'retained', team: 'CSK', price: 0.30, country: 'India' },
  { name: 'Sanju Samson', role: 'WK', status: 'retained', team: 'CSK', price: 12.00, country: 'India' },
  { name: 'Ruturaj Gaikwad', role: 'BAT', status: 'retained', team: 'CSK', price: 18.00, country: 'India' },
  { name: 'Shivam Dube', role: 'AR', status: 'retained', team: 'CSK', price: 12.00, country: 'India' },
  { name: 'Shreyas Gopal', role: 'BOWL', status: 'retained', team: 'CSK', price: 0.30, country: 'India' },
  { name: 'Syed Khaleel Ahmed', role: 'BOWL', status: 'retained', team: 'CSK', price: 5.50, country: 'India' },
  { name: 'Ayush Mhatre', role: 'BAT', status: 'retained', team: 'CSK', price: 0.30, country: 'India' },
  { name: 'Dewald Brevis', role: 'BAT', status: 'retained', team: 'CSK', price: 3.00, country: 'South Africa' },
  { name: 'Urvil Patel', role: 'WK', status: 'retained', team: 'CSK', price: 0.30, country: 'India' },
  
  // DC (17)
  { name: 'Abhishek Porel', role: 'WK', status: 'retained', team: 'DC', price: 4.00, country: 'India' },
  { name: 'Ajay Mandal', role: 'AR', status: 'retained', team: 'DC', price: 0.30, country: 'India' },
  { name: 'Ashutosh Sharma', role: 'BAT', status: 'retained', team: 'DC', price: 0.30, country: 'India' },
  { name: 'Axar Patel', role: 'AR', status: 'retained', team: 'DC', price: 16.50, country: 'India' },
  { name: 'Dushmantha Chameera', role: 'BOWL', status: 'retained', team: 'DC', price: 2.00, country: 'Sri Lanka' },
  { name: 'Karun Nair', role: 'BAT', status: 'retained', team: 'DC', price: 0.50, country: 'India' },
  { name: 'KL Rahul', role: 'BAT', status: 'retained', team: 'DC', price: 14.00, country: 'India' },
  { name: 'Kuldeep Yadav', role: 'BOWL', status: 'retained', team: 'DC', price: 2.00, country: 'India' },
  { name: 'Madhav Tiwari', role: 'BOWL', status: 'retained', team: 'DC', price: 0.30, country: 'India' },
  { name: 'Mitchell Starc', role: 'BOWL', status: 'retained', team: 'DC', price: 24.75, country: 'Australia' },
  { name: 'Mukesh Kumar', role: 'BOWL', status: 'retained', team: 'DC', price: 5.50, country: 'India' },
  { name: 'Nitish Rana', role: 'BAT', status: 'retained', team: 'DC', price: 8.00, country: 'India' },
  { name: 'Sameer Rizvi', role: 'BAT', status: 'retained', team: 'DC', price: 8.40, country: 'India' },
  { name: 'T. Natarajan', role: 'BOWL', status: 'retained', team: 'DC', price: 10.75, country: 'India' },
  { name: 'Tripurana Vijay', role: 'AR', status: 'retained', team: 'DC', price: 0.30, country: 'India' },
  { name: 'Tristan Stubbs', role: 'BAT', status: 'retained', team: 'DC', price: 9.20, country: 'South Africa' },
  { name: 'Vipraj Nigam', role: 'BAT', status: 'retained', team: 'DC', price: 0.30, country: 'India' },
  
  // GT (20)
  { name: 'Anuj Rawat', role: 'WK', status: 'retained', team: 'GT', price: 3.40, country: 'India' },
  { name: 'Glenn Phillips', role: 'BAT', status: 'retained', team: 'GT', price: 1.50, country: 'New Zealand' },
  { name: 'Gurnoor Singh Brar', role: 'AR', status: 'retained', team: 'GT', price: 2.00, country: 'India' },
  { name: 'Ishant Sharma', role: 'BOWL', status: 'retained', team: 'GT', price: 0.75, country: 'India' },
  { name: 'Jayant Yadav', role: 'AR', status: 'retained', team: 'GT', price: 0.75, country: 'India' },
  { name: 'Jos Buttler', role: 'WK', status: 'retained', team: 'GT', price: 15.75, country: 'England' },
  { name: 'Kagiso Rabada', role: 'BOWL', status: 'retained', team: 'GT', price: 14.00, country: 'South Africa' },
  { name: 'Kumar Kushagra', role: 'WK', status: 'retained', team: 'GT', price: 3.20, country: 'India' },
  { name: 'Manav Suthar', role: 'AR', status: 'retained', team: 'GT', price: 0.20, country: 'India' },
  { name: 'Mohammad Siraj', role: 'BOWL', status: 'retained', team: 'GT', price: 7.00, country: 'India' },
  { name: 'Mohd. Arshad Khan', role: 'BOWL', status: 'retained', team: 'GT', price: 0.55, country: 'India' },
  { name: 'Nishant Sindhu', role: 'BAT', status: 'retained', team: 'GT', price: 0.30, country: 'India' },
  { name: 'Prasidh Krishna', role: 'BOWL', status: 'retained', team: 'GT', price: 9.50, country: 'India' },
  { name: 'R. Sai Kishore', role: 'BOWL', status: 'retained', team: 'GT', price: 4.20, country: 'India' },
  { name: 'Rahul Tewatia', role: 'AR', status: 'retained', team: 'GT', price: 4.00, country: 'India' },
  { name: 'Rashid Khan', role: 'BOWL', status: 'retained', team: 'GT', price: 18.00, country: 'Afghanistan' },
  { name: 'Sai Sudharsan', role: 'BAT', status: 'retained', team: 'GT', price: 8.50, country: 'India' },
  { name: 'Shahrukh Khan', role: 'AR', status: 'retained', team: 'GT', price: 4.60, country: 'India' },
  { name: 'Shubman Gill', role: 'BAT', status: 'retained', team: 'GT', price: 16.50, country: 'India' },
  { name: 'Washington Sundar', role: 'AR', status: 'retained', team: 'GT', price: 3.20, country: 'India' },
  
  // KKR (12)
  { name: 'Ajinkya Rahane', role: 'BAT', status: 'retained', team: 'KKR', price: 3.20, country: 'India' },
  { name: 'Angkrish Raghuvanshi', role: 'BAT', status: 'retained', team: 'KKR', price: 4.00, country: 'India' },
  { name: 'Anukul Roy', role: 'AR', status: 'retained', team: 'KKR', price: 0.30, country: 'India' },
  { name: 'Harshit Rana', role: 'BOWL', status: 'retained', team: 'KKR', price: 4.20, country: 'India' },
  { name: 'Manish Pandey', role: 'BAT', status: 'retained', team: 'KKR', price: 0.40, country: 'India' },
  { name: 'Ramandeep Singh', role: 'AR', status: 'retained', team: 'KKR', price: 4.00, country: 'India' },
  { name: 'Rinku Singh', role: 'BAT', status: 'retained', team: 'KKR', price: 13.00, country: 'India' },
  { name: 'Rovman Powell', role: 'BAT', status: 'retained', team: 'KKR', price: 7.50, country: 'West Indies' },
  { name: 'Sunil Narine', role: 'AR', status: 'retained', team: 'KKR', price: 12.00, country: 'West Indies' },
  { name: 'Umran Malik', role: 'BOWL', status: 'retained', team: 'KKR', price: 0.80, country: 'India' },
  { name: 'Vaibhav Arora', role: 'BOWL', status: 'retained', team: 'KKR', price: 4.20, country: 'India' },
  { name: 'Varun Chakaravarthy', role: 'BOWL', status: 'retained', team: 'KKR', price: 12.00, country: 'India' },
  
  // LSG (19)
  { name: 'Abdul Samad', role: 'BAT', status: 'retained', team: 'LSG', price: 0.20, country: 'India' },
  { name: 'Aiden Markram', role: 'BAT', status: 'retained', team: 'LSG', price: 2.60, country: 'South Africa' },
  { name: 'Akash Singh', role: 'BOWL', status: 'retained', team: 'LSG', price: 0.40, country: 'India' },
  { name: 'Arjun Tendulkar', role: 'AR', status: 'retained', team: 'LSG', price: 0.30, country: 'India' },
  { name: 'Arshin Kulkarni', role: 'AR', status: 'retained', team: 'LSG', price: 0.30, country: 'India' },
  { name: 'Avesh Khan', role: 'BOWL', status: 'retained', team: 'LSG', price: 9.75, country: 'India' },
  { name: 'Ayush Badoni', role: 'BAT', status: 'retained', team: 'LSG', price: 4.00, country: 'India' },
  { name: 'Digvesh Rathi', role: 'BOWL', status: 'retained', team: 'LSG', price: 0.30, country: 'India' },
  { name: 'Himmat Singh', role: 'BAT', status: 'retained', team: 'LSG', price: 0.30, country: 'India' },
  { name: 'Manimaran Siddharth', role: 'BOWL', status: 'retained', team: 'LSG', price: 2.40, country: 'India' },
  { name: 'Matthew Breetzke', role: 'BAT', status: 'retained', team: 'LSG', price: 0.75, country: 'South Africa' },
  { name: 'Mayank Yadav', role: 'BOWL', status: 'retained', team: 'LSG', price: 11.25, country: 'India' },
  { name: 'Md Shami', role: 'BOWL', status: 'retained', team: 'LSG', price: 9.75, country: 'India' },
  { name: 'Mitchell Marsh', role: 'AR', status: 'retained', team: 'LSG', price: 4.20, country: 'Australia' },
  { name: 'Mohsin Khan', role: 'BOWL', status: 'retained', team: 'LSG', price: 4.20, country: 'India' },
  { name: 'Nicholas Pooran', role: 'WK', status: 'retained', team: 'LSG', price: 21.00, country: 'West Indies' },
  { name: 'Prince Yadav', role: 'BOWL', status: 'retained', team: 'LSG', price: 0.20, country: 'India' },
  { name: 'Rishabh Pant', role: 'WK', status: 'retained', team: 'LSG', price: 27.00, country: 'India' },
  { name: 'Shahbaz Ahmed', role: 'AR', status: 'retained', team: 'LSG', price: 2.40, country: 'India' },
  
  // MI (20)
  { name: 'Allah Ghazanfar', role: 'BOWL', status: 'retained', team: 'MI', price: 4.80, country: 'Afghanistan' },
  { name: 'Ashwani Kumar', role: 'BOWL', status: 'retained', team: 'MI', price: 0.30, country: 'India' },
  { name: 'Corbin Bosch', role: 'BOWL', status: 'retained', team: 'MI', price: 0.30, country: 'South Africa' },
  { name: 'Deepak Chahar', role: 'BOWL', status: 'retained', team: 'MI', price: 9.25, country: 'India' },
  { name: 'Hardik Pandya', role: 'AR', status: 'retained', team: 'MI', price: 16.35, country: 'India' },
  { name: 'Jasprit Bumrah', role: 'BOWL', status: 'retained', team: 'MI', price: 18.00, country: 'India' },
  { name: 'Mayank Markande', role: 'BOWL', status: 'retained', team: 'MI', price: 0.55, country: 'India' },
  { name: 'Mitchell Santner', role: 'AR', status: 'retained', team: 'MI', price: 2.00, country: 'New Zealand' },
  { name: 'Naman Dhir', role: 'AR', status: 'retained', team: 'MI', price: 5.25, country: 'India' },
  { name: 'Raghu Sharma', role: 'BOWL', status: 'retained', team: 'MI', price: 0.30, country: 'India' },
  { name: 'Raj Angad Bawa', role: 'AR', status: 'retained', team: 'MI', price: 0.30, country: 'India' },
  { name: 'Robin Minz', role: 'WK', status: 'retained', team: 'MI', price: 0.35, country: 'India' },
  { name: 'Rohit Sharma', role: 'BAT', status: 'retained', team: 'MI', price: 16.30, country: 'India' },
  { name: 'Ryan Rickelton', role: 'WK', status: 'retained', team: 'MI', price: 1.00, country: 'South Africa' },
  { name: 'Shardul Thakur', role: 'AR', status: 'retained', team: 'MI', price: 4.00, country: 'India' },
  { name: 'Sherfane Rutherford', role: 'BAT', status: 'retained', team: 'MI', price: 2.60, country: 'West Indies' },
  { name: 'Suryakumar Yadav', role: 'BAT', status: 'retained', team: 'MI', price: 16.35, country: 'India' },
  { name: 'Tilak Varma', role: 'BAT', status: 'retained', team: 'MI', price: 8.00, country: 'India' },
  { name: 'Trent Boult', role: 'BOWL', status: 'retained', team: 'MI', price: 12.50, country: 'New Zealand' },
  { name: 'Will Jacks', role: 'BAT', status: 'retained', team: 'MI', price: 5.25, country: 'England' },
  
  // PBKS (21)
  { name: 'Arshdeep Singh', role: 'BOWL', status: 'retained', team: 'PBKS', price: 18.00, country: 'India' },
  { name: 'Azmatullah Omarzai', role: 'AR', status: 'retained', team: 'PBKS', price: 2.40, country: 'Afghanistan' },
  { name: 'Harnoor Pannu', role: 'BAT', status: 'retained', team: 'PBKS', price: 0.30, country: 'India' },
  { name: 'Harpreet Brar', role: 'AR', status: 'retained', team: 'PBKS', price: 4.80, country: 'India' },
  { name: 'Lockie Ferguson', role: 'BOWL', status: 'retained', team: 'PBKS', price: 2.00, country: 'New Zealand' },
  { name: 'Marco Jansen', role: 'AR', status: 'retained', team: 'PBKS', price: 2.00, country: 'South Africa' },
  { name: 'Marcus Stoinis', role: 'AR', status: 'retained', team: 'PBKS', price: 11.00, country: 'Australia' },
  { name: 'Mitch Owen', role: 'BAT', status: 'retained', team: 'PBKS', price: 0.30, country: 'New Zealand' },
  { name: 'Musheer Khan', role: 'BAT', status: 'retained', team: 'PBKS', price: 0.30, country: 'India' },
  { name: 'Nehal Wadhera', role: 'BAT', status: 'retained', team: 'PBKS', price: 4.20, country: 'India' },
  { name: 'Prabhsimran Singh', role: 'WK', status: 'retained', team: 'PBKS', price: 4.00, country: 'India' },
  { name: 'Priyansh Arya', role: 'BAT', status: 'retained', team: 'PBKS', price: 0.30, country: 'India' },
  { name: 'Pyla Avinash', role: 'BOWL', status: 'retained', team: 'PBKS', price: 0.30, country: 'India' },
  { name: 'Shashank Singh', role: 'AR', status: 'retained', team: 'PBKS', price: 4.20, country: 'India' },
  { name: 'Shreyas Iyer', role: 'BAT', status: 'retained', team: 'PBKS', price: 26.75, country: 'India' },
  { name: 'Suryansh Shedge', role: 'BAT', status: 'retained', team: 'PBKS', price: 0.30, country: 'India' },
  { name: 'Vishnu Vinod', role: 'WK', status: 'retained', team: 'PBKS', price: 2.50, country: 'India' },
  { name: 'Vyshak Vijaykumar', role: 'BOWL', status: 'retained', team: 'PBKS', price: 2.00, country: 'India' },
  { name: 'Xavier Bartlett', role: 'BOWL', status: 'retained', team: 'PBKS', price: 0.90, country: 'Australia' },
  { name: 'Yash Thakur', role: 'BOWL', status: 'retained', team: 'PBKS', price: 1.20, country: 'India' },
  { name: 'Yuzvendra Chahal', role: 'BOWL', status: 'retained', team: 'PBKS', price: 18.00, country: 'India' },
  
  // RR (16)
  { name: 'Dhruv Jurel', role: 'WK', status: 'retained', team: 'RR', price: 14.00, country: 'India' },
  { name: 'Donovan Ferreira', role: 'WK', status: 'retained', team: 'RR', price: 0.40, country: 'South Africa' },
  { name: 'Jofra Archer', role: 'BOWL', status: 'retained', team: 'RR', price: 12.50, country: 'England' },
  { name: 'Kwena Maphaka', role: 'BOWL', status: 'retained', team: 'RR', price: 0.75, country: 'South Africa' },
  { name: 'Lhuan-Dre Pretorious', role: 'AR', status: 'retained', team: 'RR', price: 0.75, country: 'South Africa' },
  { name: 'Nandre Burger', role: 'BOWL', status: 'retained', team: 'RR', price: 0.50, country: 'South Africa' },
  { name: 'Ravindra Jadeja', role: 'AR', status: 'retained', team: 'RR', price: 18.00, country: 'India' },
  { name: 'Riyan Parag', role: 'BAT', status: 'retained', team: 'RR', price: 14.00, country: 'India' },
  { name: 'Sam Curran', role: 'AR', status: 'retained', team: 'RR', price: 18.50, country: 'England' },
  { name: 'Sandeep Sharma', role: 'BOWL', status: 'retained', team: 'RR', price: 1.40, country: 'India' },
  { name: 'Shimron Hetmyer', role: 'BAT', status: 'retained', team: 'RR', price: 8.50, country: 'West Indies' },
  { name: 'Shubham Dubey', role: 'BAT', status: 'retained', team: 'RR', price: 5.80, country: 'India' },
  { name: 'Tushar Deshpande', role: 'BOWL', status: 'retained', team: 'RR', price: 1.20, country: 'India' },
  { name: 'Vaibhav Suryavanshi', role: 'BAT', status: 'retained', team: 'RR', price: 1.10, country: 'India' },
  { name: 'Yashaswi Jaiswal', role: 'BAT', status: 'retained', team: 'RR', price: 18.00, country: 'India' },
  { name: 'Yudhvir Charak', role: 'AR', status: 'retained', team: 'RR', price: 0.30, country: 'India' },
  
  // RCB (17)
  { name: 'Abhinandan Singh', role: 'BOWL', status: 'retained', team: 'RCB', price: 0.30, country: 'India' },
  { name: 'Bhuvneshwar Kumar', role: 'BOWL', status: 'retained', team: 'RCB', price: 10.75, country: 'India' },
  { name: 'Devdutt Padikkal', role: 'BAT', status: 'retained', team: 'RCB', price: 7.75, country: 'India' },
  { name: 'Jacob Bethell', role: 'BAT', status: 'retained', team: 'RCB', price: 0.40, country: 'England' },
  { name: 'Jitesh Sharma', role: 'WK', status: 'retained', team: 'RCB', price: 11.00, country: 'India' },
  { name: 'Josh Hazlewood', role: 'BOWL', status: 'retained', team: 'RCB', price: 12.50, country: 'Australia' },
  { name: 'Krunal Pandya', role: 'AR', status: 'retained', team: 'RCB', price: 8.25, country: 'India' },
  { name: 'Nuwan Thushara', role: 'BOWL', status: 'retained', team: 'RCB', price: 1.60, country: 'Sri Lanka' },
  { name: 'Phil Salt', role: 'WK', status: 'retained', team: 'RCB', price: 11.50, country: 'England' },
  { name: 'Rajat Patidar', role: 'BAT', status: 'retained', team: 'RCB', price: 11.00, country: 'India' },
  { name: 'Rasikh Dar', role: 'BOWL', status: 'retained', team: 'RCB', price: 0.20, country: 'India' },
  { name: 'Romario Shepherd', role: 'AR', status: 'retained', team: 'RCB', price: 0.40, country: 'West Indies' },
  { name: 'Suyash Sharma', role: 'BOWL', status: 'retained', team: 'RCB', price: 2.40, country: 'India' },
  { name: 'Swapnil Singh', role: 'AR', status: 'retained', team: 'RCB', price: 0.75, country: 'India' },
  { name: 'Tim David', role: 'BAT', status: 'retained', team: 'RCB', price: 8.00, country: 'Australia' },
  { name: 'Virat Kohli', role: 'BAT', status: 'retained', team: 'RCB', price: 21.00, country: 'India' },
  { name: 'Yash Dayal', role: 'BOWL', status: 'retained', team: 'RCB', price: 3.20, country: 'India' },
  
  // SRH (15)
  { name: 'Abhishek Sharma', role: 'BAT', status: 'retained', team: 'SRH', price: 14.00, country: 'India' },
  { name: 'Aniket Verma', role: 'AR', status: 'retained', team: 'SRH', price: 0.30, country: 'India' },
  { name: 'Brydon Carse', role: 'BOWL', status: 'retained', team: 'SRH', price: 0.50, country: 'England' },
  { name: 'Eshan Malinga', role: 'BOWL', status: 'retained', team: 'SRH', price: 0.30, country: 'Sri Lanka' },
  { name: 'Harsh Dubey', role: 'AR', status: 'retained', team: 'SRH', price: 0.30, country: 'India' },
  { name: 'Harshal Patel', role: 'BOWL', status: 'retained', team: 'SRH', price: 8.00, country: 'India' },
  { name: 'Heinrich Klaasen', role: 'WK', status: 'retained', team: 'SRH', price: 23.00, country: 'South Africa' },
  { name: 'Ishan Kishan', role: 'WK', status: 'retained', team: 'SRH', price: 11.25, country: 'India' },
  { name: 'Jaydev Unadkat', role: 'BOWL', status: 'retained', team: 'SRH', price: 1.50, country: 'India' },
  { name: 'Kamindu Mendis', role: 'AR', status: 'retained', team: 'SRH', price: 0.30, country: 'Sri Lanka' },
  { name: 'Nitish Kumar Reddy', role: 'AR', status: 'retained', team: 'SRH', price: 6.00, country: 'India' },
  { name: 'Pat Cummins', role: 'BOWL', status: 'retained', team: 'SRH', price: 20.50, country: 'Australia' },
  { name: 'Smaran Ravichandaran', role: 'BOWL', status: 'retained', team: 'SRH', price: 0.30, country: 'India' },
  { name: 'Travis Head', role: 'BAT', status: 'retained', team: 'SRH', price: 14.00, country: 'Australia' },
  { name: 'Zeeshan Ansari', role: 'BOWL', status: 'retained', team: 'SRH', price: 0.20, country: 'India' },
];

// Sample Auction Pool (base prices from official list - extend as needed)
const auctionPlayers = [
  { name: 'Devon Conway', role: 'BAT', status: 'available', team: '', price: 0, country: 'New Zealand', basePrice: 2.00 },
  { name: 'Jake Fraser-McGurk', role: 'BAT', status: 'available', team: '', price: 0, country: 'Australia', basePrice: 2.00 },
  { name: 'Cameron Green', role: 'AR', status: 'available', team: '', price: 0, country: 'Australia', basePrice: 2.00 },
  { name: 'Sarfaraz Khan', role: 'BAT', status: 'available', team: '', price: 0, country: 'India', basePrice: 0.75 },
  { name: 'David Miller', role: 'BAT', status: 'available', team: '', price: 0, country: 'South Africa', basePrice: 2.00 },
  { name: 'Prithvi Shaw', role: 'BAT', status: 'available', team: '', price: 0, country: 'India', basePrice: 0.75 },
  { name: 'Gus Atkinson', role: 'BOWL', status: 'available', team: '', price: 0, country: 'England', basePrice: 2.00 },
  { name: 'Wanindu Hasaranga', role: 'AR', status: 'available', team: '', price: 0, country: 'Sri Lanka', basePrice: 2.00 },
  { name: 'Deepak Hooda', role: 'AR', status: 'available', team: '', price: 0, country: 'India', basePrice: 0.75 },
  { name: 'Venkatesh Iyer', role: 'AR', status: 'available', team: '', price: 0, country: 'India', basePrice: 2.00 },
  { name: 'Matthew Short', role: 'AR', status: 'available', team: '', price: 0, country: 'Australia', basePrice: 1.50 },
  // Add more from IPL 2026 auction list as needed (543 total)
];

async function seedPlayers(players: any[]) {
  for (const player of players) {
    // Generate cricsheetId from name (replace spaces with underscores)
    const cricsheetId = player.name.replace(/\s+/g, '_');
    
    await Player.findOneAndUpdate(
      { name: player.name },
      { 
        ...player,
        cricsheetId,
        stats: { 
          batting: { avg: 0, sr: 0, runs: 0 }, 
          bowling: { avg: 0, econ: 0, wickets: 0 } 
        },
        tier: 1, // Default tier, will be updated with Cricsheet data
        isOverseas: player.country !== 'India'
      },
      { upsert: true, new: true }
    );
  }
  console.log(`✅ Seeded ${players.length} players`);
}

async function main() {
  try {
    console.log('🌱 Starting IPL 2026 Complete Player Seeding...\n');
    await connectDB();

    // Clear existing data
    console.log('🧹 Clearing existing players...');
    await Player.deleteMany({});
    console.log('   ✅ Cleared\n');

    // Seed Retained Players (173)
    console.log('📥 Seeding retained players...');
    await seedPlayers(retainedPlayers);
    console.log(`   ✅ Seeded ${retainedPlayers.length} retained players\n`);

    // Seed Auction Pool
    console.log('📥 Seeding auction pool players...');
    await seedPlayers(auctionPlayers);
    console.log(`   ✅ Seeded ${auctionPlayers.length} auction players\n`);

    // Summary
    const totalPlayers = await Player.countDocuments();
    const retainedCount = await Player.countDocuments({ status: 'retained' });
    const availableCount = await Player.countDocuments({ status: 'available' });
    const overseasCount = await Player.countDocuments({ isOverseas: true });

    console.log('📊 Summary:');
    console.log(`   Total Players: ${totalPlayers}`);
    console.log(`   Retained: ${retainedCount}`);
    console.log(`   Available for Auction: ${availableCount}`);
    console.log(`   Overseas: ${overseasCount}`);
    console.log(`   Indian: ${totalPlayers - overseasCount}`);

    console.log('\n✅ IPL 2026 Complete Player Seeding finished successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding players:', error);
    process.exit(1);
  }
}

main();
