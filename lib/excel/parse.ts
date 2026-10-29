import * as XLSX from 'xlsx';
import type { DailyEntry, FinanceLoan, FinanceMonth, PurchaseEntry, BusinessSettings, VendorDefectReturn } from '@/types/domain';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS } from '@/lib/constants';

function toNumber(v: unknown, context = 'Amount') {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${context} must be a valid number.`);
  return n;
}
function toISODate(v: unknown, context = 'Date'): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) throw new Error(`${context} must be a valid date.`);
    return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  }
  if (typeof v === 'number') {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed) throw new Error(`${context} must be a valid date.`);
    return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const parsed = new Date(`${s}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s) {
      throw new Error(`${context} must be a valid date.`);
    }
    return s;
  }
  const parsed = new Date(s);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${context} must be a valid date.`);
  return parsed.toISOString().slice(0, 10);
}

export function parseConicWorkbook(buffer: Buffer, businessId: string) {
  const book = XLSX.read(buffer, { cellDates: true });
  const settingsSheet = book.Sheets['Settings'];
  const dailySheet = book.Sheets['Daily Sales & Expenses'];
  const purchasesSheet = book.Sheets['Weekly Purchases'];
  if (!dailySheet || !purchasesSheet || !settingsSheet) throw new Error('Workbook must contain Settings, Daily Sales & Expenses, and Weekly Purchases sheets.');

  const settingsRows = XLSX.utils.sheet_to_json<any[]>(settingsSheet, { header: 1, defval: null });
  let openingOnlineBalance = 0, openingCashBalance = 0;
  for (const row of settingsRows) {
    if (row?.[0] === 'Opening Online Balance') openingOnlineBalance = toNumber(row[1], 'Opening Online Balance');
    if (row?.[0] === 'Opening Cash Balance') openingCashBalance = toNumber(row[1], 'Opening Cash Balance');
  }
  const vendors = settingsRows.slice(6).map(r => r?.[0]).filter(Boolean).map(String);
  const expenseCategories = settingsRows.slice(6).map(r => r?.[2]).filter(Boolean).map(String);
  const finalVendors = vendors.length ? vendors : DEFAULT_VENDORS;
  const finalExpenses = expenseCategories.length ? expenseCategories : DEFAULT_EXPENSE_CATEGORIES;

  const dailySheetRows = XLSX.utils.sheet_to_json<any[]>(dailySheet, { header: 1, defval: null });
  const dailyHeader = dailySheetRows[0] || [];
  const dailyRows = dailySheetRows.slice(1);
  const dailyColumn = (name:string,fallback:number) => { const index=dailyHeader.findIndex((value:unknown)=>String(value||'').trim()===name); return index>=0?index:fallback; };
  const dailyEntries: DailyEntry[] = [];
  for (const [index, row] of dailyRows.entries()) {
    const rowNumber = index + 2;
    const date = toISODate(row?.[dailyColumn('Date',0)], `Daily Sales & Expenses row ${rowNumber} date`); if (!date) continue;
    const expenses: Record<string, number> = {};
    finalExpenses.forEach((name, i) => expenses[name] = toNumber(row?.[dailyColumn(name,4+i)], `${name} on Daily Sales & Expenses row ${rowNumber}`));
    const onlineSales=toNumber(row?.[dailyColumn('Online Sales',1)], `Online Sales on Daily Sales & Expenses row ${rowNumber}`),cashSales=toNumber(row?.[dailyColumn('Cash Sales',2)], `Cash Sales on Daily Sales & Expenses row ${rowNumber}`);
    const expensePaidOnline=toNumber(row?.[dailyColumn('Expense Paid Online',9)], `Expense Paid Online on Daily Sales & Expenses row ${rowNumber}`),expensePaidCash=toNumber(row?.[dailyColumn('Expense Paid Cash',10)], `Expense Paid Cash on Daily Sales & Expenses row ${rowNumber}`);
    const notes=String(row?.[dailyColumn('Notes',15)]||'');
    if (onlineSales || cashSales || Object.values(expenses).some(Boolean) || expensePaidOnline || expensePaidCash || notes) {
      dailyEntries.push({ businessId, date, onlineSales, cashSales, expenses, expensePaidOnline, expensePaidCash, notes });
    }
  }

  const pRows = XLSX.utils.sheet_to_json<any[]>(purchasesSheet, { header: 1, defval: null }).slice(1);
  const header = XLSX.utils.sheet_to_json<any[]>(purchasesSheet, { header: 1, defval: null })[0] || [];
  const reservedPurchaseColumns = new Set(['Purchase Date','Payment Date','Total Weekly Purchase','Online Purchase Paid','Cash Purchase Paid','Pending Purchase']);
  const sheetPurchaseCategories = header.map((value,index)=>({name:String(value||'').trim(),index})).filter(item=>item.index>=2&&item.name&&!reservedPurchaseColumns.has(item.name));
  const purchaseCategories = sheetPurchaseCategories.length ? sheetPurchaseCategories : finalVendors.map((name,index)=>({name,index:index+2}));
  const purchaseColumn=(name:string,fallback:number) => {const index=header.findIndex((value:unknown)=>String(value||'').trim()===name);return index>=0?index:fallback;};
  const purchaseEntries: PurchaseEntry[] = [];
  for (const [index, row] of pRows.entries()) {
    const rowNumber = index + 2;
    const purchaseDate = toISODate(row?.[purchaseColumn('Purchase Date',0)], `Weekly Purchases row ${rowNumber} purchase date`); if (!purchaseDate) continue;
    const vendorAmounts: Record<string, number> = {};
    purchaseCategories.forEach(({name,index: column}) => vendorAmounts[name] = toNumber(row?.[column], `${name} on Weekly Purchases row ${rowNumber}`));
    const onlinePurchasePaid = toNumber(row?.[purchaseColumn('Online Purchase Paid',13)], `Online Purchase Paid on Weekly Purchases row ${rowNumber}`); const cashPurchasePaid = toNumber(row?.[purchaseColumn('Cash Purchase Paid',14)], `Cash Purchase Paid on Weekly Purchases row ${rowNumber}`);
    if (Object.values(vendorAmounts).some(Boolean) || onlinePurchasePaid || cashPurchasePaid) {
      purchaseEntries.push({ businessId, purchaseDate, paymentDate: toISODate(row?.[purchaseColumn('Payment Date',1)], `Weekly Purchases row ${rowNumber} payment date`), vendorAmounts, onlinePurchasePaid, cashPurchasePaid });
    }
  }

  const financeSheet=book.Sheets['Additional Finance'];
  const financeDataPresent=Boolean(financeSheet);
  const monthlyFinanceMap=new Map<string,FinanceMonth>();
  const financeLoansMap=new Map<string,FinanceLoan>();
  const vendorReturnsMap=new Map<string,VendorDefectReturn>();
  if(financeSheet){
    const financeRows=XLSX.utils.sheet_to_json<any[]>(financeSheet,{header:1,defval:null}).slice(3);
    const getMonth=(period:string)=>{
      if(!/^\d{4}-\d{2}$/.test(period))return null;
      if(!monthlyFinanceMap.has(period)){
        const [year,month]=period.split('-').map(Number);
        monthlyFinanceMap.set(period,{businessId,period,year,month,salaries:[],truckEmi:0,autoEmi:0,roomRent:0,savingsDeposit:0,partnerPayments:[]});
      }
      return monthlyFinanceMap.get(period)!;
    };
    for(const [index,row] of financeRows.entries()){
      const rowNumber=index+4;
      const type=String(row?.[0]||'').trim(),dateOrPeriod=String(row?.[1]||'').trim(),name=String(row?.[2]||'').trim(),source=String(row?.[3]||'').trim();
      if(!type)continue;
      const value=toNumber(row?.[4], `${type} amount on Additional Finance row ${rowNumber}`),recordId=String(row?.[8]||'').trim(),paymentDate=toISODate(row?.[9], `Additional Finance row ${rowNumber} payment date`)||undefined;
      if(type==='Dated Savings Deposit'){
        const date=toISODate(row?.[1], `Additional Finance row ${rowNumber} date`)||paymentDate;
        if(!date)continue;
        const month=getMonth(date.slice(0,7));
        if(month)month.savingsEntries=[...(month.savingsEntries||[]),{date,amount:value,note:String(row?.[7]||'')}];
        continue;
      }
      if(['Salary','Truck EMI','Auto EMI','Room Rent','Savings Deposit','Partner Payout'].includes(type)){
        const month=getMonth(dateOrPeriod);if(!month)continue;
        if(type==='Salary'&&name){
          const paidOnline=row?.[10]===null||row?.[10]===undefined?value:toNumber(row[10], `Paid Online on Additional Finance row ${rowNumber}`);
          const paidCash=row?.[11]===null||row?.[11]===undefined?0:toNumber(row[11], `Paid Cash on Additional Finance row ${rowNumber}`);
          month.salaries.push({person:name,amount:value,paidOnline,paidCash,paymentDate});
        }
        else if(type==='Truck EMI'){month.truckEmi=value;month.truckEmiPaymentDate=paymentDate;}
        else if(type==='Auto EMI'){month.autoEmi=value;month.autoEmiPaymentDate=paymentDate;}
        else if(type==='Room Rent')month.roomRent=value;
        else if(type==='Savings Deposit')month.savingsDeposit=value;
        else if(type==='Partner Payout'&&name)month.partnerPayments.push({partner:name,amount:value,paymentDate});
        continue;
      }
      if(type==='Loan Received'){
        const takenDate=toISODate(dateOrPeriod, `Additional Finance row ${rowNumber} loan date`);if(!takenDate||!name)continue;
        const key=recordId||`${name}|${takenDate}|${source}`;
        financeLoansMap.set(key,{businessId,person:name,source:source==='partner'||source==='other'?source:'friend',amountTaken:value,takenDate,repayments:[],notes:String(row?.[7]||'')});
      }else if(type==='Loan Repayment'){
        const date=toISODate(dateOrPeriod, `Additional Finance row ${rowNumber} repayment date`);if(!date)continue;
        const key=recordId||`${name}|${date}|${source}`;
        const loan=financeLoansMap.get(key);
        if(loan)loan.repayments.push({date,amount:value});
      }else if(type==='Vendor Defect Return'){
        const returnDate=toISODate(dateOrPeriod, `Additional Finance row ${rowNumber} return date`);if(!returnDate||!name)continue;
        const key=recordId||`${name}|${returnDate}`;
        vendorReturnsMap.set(key,{businessId,vendor:name,returnDate,amount:value,receipts:[],notes:String(row?.[7]||'')});
      }else if(type==='Vendor Refund Received'){
        const date=toISODate(dateOrPeriod, `Additional Finance row ${rowNumber} receipt date`);if(!date)continue;
        const key=recordId||`${name}|${date}`;
        const credit=vendorReturnsMap.get(key);
        if(credit)credit.receipts.push({date,amount:value});
      }
    }
  }

  const settings: BusinessSettings = { name: 'CONIC', currency: 'INR', dateFormat: 'DD-MMM-YYYY', openingOnlineBalance, openingCashBalance, vendors: finalVendors, expenseCategories: finalExpenses };
  return { settings, dailyEntries, purchaseEntries, financeDataPresent, monthlyFinance: [...monthlyFinanceMap.values()], financeLoans: [...financeLoansMap.values()], vendorDefectReturns: [...vendorReturnsMap.values()] };
}
