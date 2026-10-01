import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { buildWorkbookFromData } from '../lib/excel/export';
import { parseConicWorkbook } from '../lib/excel/parse';

const settings={name:'TEST',currency:'INR' as const,dateFormat:'DD-MMM-YYYY' as const,openingOnlineBalance:80000,openingCashBalance:20000,vendors:[],expenseCategories:['Police','Shop','Transport','Other']};
const daily:any[]=[{businessId:'test',date:'2026-09-03',onlineSales:5000,cashSales:1000,expenses:{Police:500},expensePaidOnline:500,expensePaidCash:0,notes:''}];
const loans:any[]=[{businessId:'test',person:'Friend A',source:'friend',amountTaken:50000,takenDate:'2026-09-01',repayments:[{date:'2026-09-03',amount:3000}],notes:'test'}];

async function main(){
 const buffer=await buildWorkbookFromData(fs.readFileSync('data/templates/CONIC_Business_Tracker.xlsx'),daily,[],settings,{loans});
 const workbook=XLSX.read(buffer,{cellDates:true,cellFormula:true});
 const dailySheet=workbook.Sheets['Daily Sales & Expenses'];
 const financeSheet=workbook.Sheets['Additional Finance'];
 const parsed=parseConicWorkbook(buffer,'test');
 const results={totalBalance:dailySheet.N2?.v,loanBorrowed:financeSheet.E4?.v,loanRepaid:financeSheet.F4?.v,loanPending:financeSheet.G4?.v,roundTripRepaid:parsed.financeLoans[0]?.repayments[0]?.amount};
 console.log(results);
 if(results.totalBalance!==102500||results.loanBorrowed!==50000||results.loanRepaid!==3000||results.loanPending!==47000||results.roundTripRepaid!==3000)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1});
