import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/mongodb';
import { calculateBalancesThrough as balanceThrough } from '@/lib/finance/balances';
import { BUSINESS_ID, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS, MONTHS } from '@/lib/constants';
import type { BusinessSettings, DailyEntry, FinanceLoan, FinanceMonth, PurchaseEntry, VendorDefectReturn } from '@/types/domain';

type AdditionalFinanceData = { months?: FinanceMonth[]; loans?: FinanceLoan[]; vendorReturns?: VendorDefectReturn[] };
type FinanceSheetRow = { type: string; dateOrPeriod: string | number; name: string; source: string; amount: number; received: number; outstanding: number; notes: string; recordId: string };

function excelSerial(iso: string | null) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Math.floor((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}
function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function cellNum(ref: string, value: number | null, style?: string) { return value === null ? '' : `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`; }
function cellText(ref: string, value: string, style?: string) { return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t>${esc(value)}</t></is></c>`; }
function cellFormula(ref: string, formula: string, cachedValue = 0) { return `<c r="${ref}"><f>${esc(formula)}</f><v>${cachedValue}</v></c>`; }
function excelColumn(index: number) { let value = index + 1, result = ''; while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); } return result; }
function columnIndex(column: string) { return [...column].reduce((total,char)=>total*26+char.charCodeAt(0)-64,0); }
function settingsSlots(xml:string){
  const rows=[...xml.matchAll(/<c\b[^>]*\br="([AC])(\d+)"/g)].map(match=>({column:match[1],row:Number(match[2])}));
  return {vendors:Math.max(0,...rows.filter(cell=>cell.column==='A').map(cell=>cell.row-6)),expenses:Math.max(0,...rows.filter(cell=>cell.column==='C').map(cell=>cell.row-6))};
}
function setWorksheetCell(xml: string, ref: string, markup: string) {
  const escapedRef=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const cellPattern=new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  if(cellPattern.test(xml)) return xml.replace(cellPattern,()=>markup);
  const match=/^([A-Z]+)(\d+)$/.exec(ref);
  if(!match) return xml;
  const rowNumber=Number(match[2]),targetColumn=columnIndex(match[1]);
  const rowPattern=new RegExp(`(<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>)([\\s\\S]*?)<\\/row>`);
  const rowMatch=rowPattern.exec(xml);
  if(rowMatch){
    const content=rowMatch[2];
    const cellPatternInRow=/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g;
    let insertion=content.length,cellMatch:RegExpExecArray|null;
    while((cellMatch=cellPatternInRow.exec(content))){if(columnIndex(cellMatch[1])>targetColumn){insertion=cellMatch.index;break;}}
    const newRow=`${rowMatch[1]}${content.slice(0,insertion)}${markup}${content.slice(insertion)}</row>`;
    return xml.replace(rowPattern,()=>newRow);
  }
  const newRow=`<row r="${rowNumber}">${markup}</row>`;
  const sheetDataEnd=xml.indexOf('</sheetData>');
  if(sheetDataEnd<0) return xml;
  const prefix=xml.slice(0,sheetDataEnd),rowTags=[...prefix.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>/g)];
  const laterRow=rowTags.find(row=>Number(row[1])>rowNumber);
  return laterRow?xml.slice(0,laterRow.index)+newRow+xml.slice(laterRow.index):xml.slice(0,sheetDataEnd)+newRow+xml.slice(sheetDataEnd);
}
function setFormulaCell(xml:string,ref:string,formula:string,cachedValue=0){
  const escapedRef=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`(<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*>)[\\s\\S]*?<\\/c>`);
  const match=pattern.exec(xml);
  return match?xml.replace(pattern,()=>`${match[1]}<f>${esc(formula)}</f><v>${cachedValue}</v></c>`):setWorksheetCell(xml,ref,cellFormula(ref,formula,cachedValue));
}
function setFormulaCache(xml:string,ref:string,value:number){
  const escapedRef=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*>[\\s\\S]*?<\\/c>`);
  return xml.replace(pattern,cell=>/<v\b[^>]*>[\s\S]*?<\/v>/.test(cell)?cell.replace(/<v\b[^>]*>[\s\S]*?<\/v>/,`<v>${value}</v>`):cell.replace('</c>',`<v>${value}</v></c>`));
}
function updateTableXml(xml:string,headers:string[],lastColumn:string,lastRow:number){
  const used=new Set<string>();
  const columns=headers.map((header,index)=>{let name=header.trim()||`Unused Column ${index+1}`;while(used.has(name))name=`${name} ${index+1}`;used.add(name);return `<tableColumn id="${index+1}" name="${esc(name)}"/>`;}).join('');
  xml=xml.replace(/ref="A1:[A-Z]+\d+"/,`ref="A1:${lastColumn}${lastRow}"`);
  return xml.replace(/<tableColumns\b[^>]*>[\s\S]*?<\/tableColumns>/,`<tableColumns count="${headers.length}">${columns}</tableColumns>`);
}
function replaceWorksheetData(templateXml:string,generatedXml:string,minimumRows:number){
  const generatedData=/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/.exec(generatedXml)?.[0];
  if(!generatedData) throw new Error('Generated worksheet data is missing.');
  const existingDimension=/\<dimension\b[^>]*\bref="A1:([A-Z]+)(\d+)"[^>]*\/>/.exec(templateXml);
  const generatedDimension=/\<dimension\b[^>]*\bref="A1:([A-Z]+)(\d+)"[^>]*\/>/.exec(generatedXml);
  if(existingDimension&&generatedDimension){
    const lastColumn=excelColumn(Math.max(columnIndex(existingDimension[1]),columnIndex(generatedDimension[1]))-1);
    const lastRow=Math.max(Number(existingDimension[2]),Number(generatedDimension[2]),minimumRows);
    templateXml=templateXml.replace(existingDimension[0],`<dimension ref="A1:${lastColumn}${lastRow}"/>`);
  }
  const dataPattern=/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/;
  if(!dataPattern.test(templateXml)) throw new Error('Template worksheet data is missing.');
  return templateXml.replace(dataPattern,()=>generatedData);
}

function buildFinanceSheet(finance:AdditionalFinanceData){
  const records:FinanceSheetRow[]=[];
  for(const month of finance.months||[]){
    const period=month.period;
    for(const salary of month.salaries||[]) records.push({type:'Salary',dateOrPeriod:period,name:salary.person,source:'',amount:Number(salary.amount||0),received:0,outstanding:0,notes:'',recordId:''});
    for(const [type,amount] of [['Truck EMI',month.truckEmi],['Auto EMI',month.autoEmi],['Room Rent',month.roomRent],['Savings Deposit',month.savingsDeposit]] as const) records.push({type,dateOrPeriod:period,name:'',source:'',amount:Number(amount||0),received:0,outstanding:0,notes:'',recordId:''});
    for(const payment of month.partnerPayments||[]) records.push({type:'Partner Payout',dateOrPeriod:period,name:payment.partner,source:'Savings',amount:Number(payment.amount||0),received:0,outstanding:0,notes:'Quarterly payout from savings',recordId:''});
  }
  for(const loan of finance.loans||[]){
    const id=String(loan._id||`${loan.person}-${loan.takenDate}`);
    const repaid=(loan.repayments||[]).reduce((sum,item)=>sum+Number(item.amount||0),0);
    records.push({type:'Loan Received',dateOrPeriod:loan.takenDate,name:loan.person,source:loan.source,amount:Number(loan.amountTaken||0),received:repaid,outstanding:Math.max(0,Number(loan.amountTaken||0)-repaid),notes:loan.notes||'',recordId:id});
    for(const repayment of loan.repayments||[]) records.push({type:'Loan Repayment',dateOrPeriod:excelSerial(repayment.date)||0,name:loan.person,source:loan.source,amount:Number(repayment.amount||0),received:0,outstanding:0,notes:'',recordId:id});
  }
  for(const credit of finance.vendorReturns||[]){
    const id=String(credit._id||`${credit.vendor}-${credit.returnDate}`);
    const received=(credit.receipts||[]).reduce((sum,item)=>sum+Number(item.amount||0),0);
    records.push({type:'Vendor Defect Return',dateOrPeriod:excelSerial(credit.returnDate)||0,name:credit.vendor,source:'',amount:Number(credit.amount||0),received,outstanding:Math.max(0,Number(credit.amount||0)-received),notes:credit.notes||'',recordId:id});
    for(const receipt of credit.receipts||[]) records.push({type:'Vendor Refund Received',dateOrPeriod:excelSerial(receipt.date)||0,name:credit.vendor,source:'',amount:Number(receipt.amount||0),received:0,outstanding:0,notes:'',recordId:id});
  }
  const headers=['Record Type','Month / Date','Person / Vendor','Source','Amount','Repaid / Received','Remaining / Pending','Notes','Related Record ID'];
  const tableHeader=`<row r="3">${headers.map((header,index)=>cellText(`${excelColumn(index)}3`,header,'5')).join('')}</row>`;
  const rows=records.map((record,index)=>{const row=index+4;const dateCell=typeof record.dateOrPeriod==='number'?cellNum(`B${row}`,record.dateOrPeriod,'17'):cellText(`B${row}`,record.dateOrPeriod,'12');return `<row r="${row}">${[cellText(`A${row}`,record.type,'12'),dateCell,cellText(`C${row}`,record.name,'12'),cellText(`D${row}`,record.source,'12'),cellNum(`E${row}`,record.amount,'18'),cellNum(`F${row}`,record.received,'18'),cellNum(`G${row}`,record.outstanding,'18'),cellText(`H${row}`,record.notes,'12'),cellText(`I${row}`,record.recordId,'12')].join('')}</row>`;}).join('');
  const lastRow=Math.max(3,records.length+3);
  return {xml:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:I${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData><row r="1">${cellText('A1','Additional Finance & Liabilities','5')}</row><row r="2">${cellText('A2','Monthly charges and repayments reduce total balance; savings deposits move funds to savings. Borrowed loan amounts stay separate.','12')}</row>${tableHeader}${rows}</sheetData></worksheet>`,lastRow};
}

async function appendFinanceSheet(zip:JSZip,finance:AdditionalFinanceData){
  const workbookPath='xl/workbook.xml',relationshipsPath='xl/_rels/workbook.xml.rels',contentTypesPath='[Content_Types].xml';
  let workbook=await zip.file(workbookPath)!.async('string');
  let relationships=await zip.file(relationshipsPath)!.async('string');
  let contentTypes=await zip.file(contentTypesPath)!.async('string');
  const maxSheetId=Math.max(0,...[...workbook.matchAll(/<sheet\b[^>]*\bsheetId="(\d+)"/g)].map(match=>Number(match[1])));
  const maxRelationshipId=Math.max(0,...[...relationships.matchAll(/\bId="rId(\d+)"/g)].map(match=>Number(match[1])));
  const maxWorksheetNumber=Math.max(0,...Object.keys(zip.files).map(name=>/^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name)).filter(Boolean).map(match=>Number(match![1])));
  const sheetId=maxSheetId+1,relationshipId=`rId${maxRelationshipId+1}`,sheetPath=`xl/worksheets/sheet${maxWorksheetNumber+1}.xml`;
  const sheetName='Additional Finance';
  workbook=workbook.replace('</sheets>',`<sheet name="${sheetName}" sheetId="${sheetId}" r:id="${relationshipId}"/></sheets>`);
  relationships=relationships.replace('</Relationships>',`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${path.basename(sheetPath)}"/></Relationships>`);
  contentTypes=contentTypes.replace('</Types>',`<Override PartName="/${sheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  const sheet=buildFinanceSheet(finance);
  zip.file(workbookPath,workbook);zip.file(relationshipsPath,relationships);zip.file(contentTypesPath,contentTypes);zip.file(sheetPath,sheet.xml);
  return sheet.lastRow;
}

function buildDailyXml(entries: DailyEntry[], expenseCategories: string[], purchases: PurchaseEntry[], opening: { online: number; cash: number }, finance:AdditionalFinanceData) {
  const categories = [...new Set([...expenseCategories, ...entries.flatMap(entry => Object.keys(entry.expenses || {}))])];
  const fixedCategories = categories.slice(0, 4);
  const overflowCategories = categories.slice(4);
  const categoryCell = (entry: DailyEntry, name: string, column: number, row: number) => cellNum(`${excelColumn(column)}${row}`, Number(entry.expenses?.[name] || 0), '18');
  const rows = entries.map((e, i) => {
    const r=i+2, totalSales=e.onlineSales+e.cashSales, totalExpenses=Object.values(e.expenses||{}).reduce((a,b)=>a+Number(b||0),0);
    const balances = balanceThrough(e.date, entries, purchases, opening, finance.months, finance.vendorReturns, finance.loans);
    const cells = [
      cellNum(`A${r}`,excelSerial(e.date),'17'),cellNum(`B${r}`,e.onlineSales,'18'),cellNum(`C${r}`,e.cashSales,'18'),
      cellNum(`D${r}`,totalSales,'15'),
      ...fixedCategories.map((name,index)=>categoryCell(e,name,4+index,r)),
      ...Array.from({length:Math.max(0,4-fixedCategories.length)},(_,index)=>cellNum(`${excelColumn(4+fixedCategories.length+index)}${r}`,0,'18')),
      cellNum(`I${r}`,totalExpenses,'15'),cellNum(`J${r}`,e.expensePaidOnline,'15'),cellNum(`K${r}`,e.expensePaidCash,'15'),
      cellNum(`L${r}`,balances.online,'15'),cellNum(`M${r}`,balances.cash,'15'),cellNum(`N${r}`,balances.total,'15'),cellNum(`O${r}`,totalSales-totalExpenses,'15'),cellText(`P${r}`,e.notes||'')
    ];
    overflowCategories.forEach((name,index)=>cells.push(categoryCell(e,name,16+index,r)));
    return `<row r="${r}">${cells.join('')}</row>`;
  }).join('');
  const headers=['Date','Online Sales','Cash Sales','Total Sales',...fixedCategories,...Array.from({length:Math.max(0,4-fixedCategories.length)},()=>''),'Total Expenses','Expense Paid Online','Expense Paid Cash','Online Balance','Cash Balance','Total Balance','Daily Net Amount','Notes',...overflowCategories];
  const header=`<row r="1">${headers.map((x,i)=>cellText(`${excelColumn(i)}1`,x,'5')).join('')}</row>`;
  const lastRow=Math.max(1,entries.length+1),lastColumn=excelColumn(Math.max(15,15+overflowCategories.length));
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${header}${rows}</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`;
  return {xml,headers,lastRow,lastColumn};
}
function buildPurchaseXml(entries: PurchaseEntry[], vendors: string[]) {
  const allCategories = [...new Set([...vendors, ...entries.flatMap(entry=>Object.keys(entry.vendorAmounts||{}))])].filter(name=>name!=='Other'&&name!=='Transport');
  const fixedVendors=allCategories.slice(0,10);
  const overflowCategories=[...allCategories.slice(10),'Other','Transport'];
  const rows = entries.map((e,i)=>{ const r=i+2; const total=Object.values(e.vendorAmounts||{}).reduce((a,b)=>a+Number(b||0),0); const pending=Math.max(0,total-Number(e.onlinePurchasePaid||0)-Number(e.cashPurchasePaid||0)); const cells=[cellNum(`A${r}`,excelSerial(e.purchaseDate),'17'),cellNum(`B${r}`,excelSerial(e.paymentDate),'17'),...fixedVendors.map((name,index)=>cellNum(`${excelColumn(index+2)}${r}`,Number(e.vendorAmounts?.[name]||0),'18')),...Array.from({length:Math.max(0,10-fixedVendors.length)},(_,index)=>cellNum(`${excelColumn(2+fixedVendors.length+index)}${r}`,0,'18')),cellNum(`M${r}`,total,'15'),cellNum(`N${r}`,Number(e.onlinePurchasePaid||0),'15'),cellNum(`O${r}`,Number(e.cashPurchasePaid||0),'18'),cellNum(`P${r}`,pending,'15'),...overflowCategories.map((name,index)=>cellNum(`${excelColumn(16+index)}${r}`,Number(e.vendorAmounts?.[name]||0),'18'))]; return `<row r="${r}">${cells.join('')}</row>`; }).join('');
  const headers=['Purchase Date','Payment Date',...fixedVendors,...Array.from({length:Math.max(0,10-fixedVendors.length)},()=>''),'Total Weekly Purchase','Online Purchase Paid','Cash Purchase Paid','Pending Purchase',...overflowCategories];
  const header=`<row r="1">${headers.map((x,i)=>cellText(`${excelColumn(i)}1`,x,'5')).join('')}</row>`;
  const lastRow=Math.max(1,entries.length+1),lastColumn=excelColumn(Math.max(15,15+overflowCategories.length));
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${header}${rows}</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`;
  return {xml,headers,lastRow,lastColumn};
}

export async function buildWorkbookFromData(template:Buffer,daily:DailyEntry[],purchases:PurchaseEntry[],settings:BusinessSettings,finance:AdditionalFinanceData={}):Promise<Buffer>{
  const templateWorkbook=XLSX.read(template,{cellDates:true});
  const dashboard=templateWorkbook.Sheets['Monthly Dashboard'];
  const monthlySelectedYear=Number(dashboard?.D3?.v)||new Date().getFullYear();
  const selectedMonth=Math.max(1,MONTHS.indexOf(String(dashboard?.B3?.v))+1);
  const periodStart=`${monthlySelectedYear}-${String(selectedMonth).padStart(2,'0')}-01`;
  const nextMonthDate=new Date(Date.UTC(monthlySelectedYear,selectedMonth,1));
  const periodEnd=nextMonthDate.toISOString().slice(0,10);
  const monthDaily=daily.filter(entry=>entry.date>=periodStart&&entry.date<periodEnd);
  const monthPurchases=purchases.filter(entry=>entry.purchaseDate>=periodStart&&entry.purchaseDate<periodEnd);
  const monthFinance=(finance.months||[]).find(entry=>entry.period===`${monthlySelectedYear}-${String(selectedMonth).padStart(2,'0')}`);
  const monthlySalary=(monthFinance?.salaries||[]).reduce((sum,salary)=>sum+Number(salary.amount||0),0);
  const monthlyOperationsExpenses=monthlySalary+Number(monthFinance?.truckEmi||0)+Number(monthFinance?.autoEmi||0)+Number(monthFinance?.roomRent||0);
  const monthlyLoanRepayments=(finance.loans||[]).flatMap(loan=>loan.repayments||[]).filter(repayment=>repayment.date>=periodStart&&repayment.date<periodEnd).reduce((sum,repayment)=>sum+Number(repayment.amount||0),0);
  const totalSales=monthDaily.reduce((total,entry)=>total+Number(entry.onlineSales||0)+Number(entry.cashSales||0),0);
  const dailyExpenses=monthDaily.reduce((total,entry)=>total+Object.values(entry.expenses||{}).reduce((amount,value)=>amount+Number(value||0),0),0);
  const totalExpenses=dailyExpenses+monthlyOperationsExpenses+monthlyLoanRepayments;
  const totalPurchases=monthPurchases.reduce((total,entry)=>total+Object.values(entry.vendorAmounts||{}).reduce((amount,value)=>amount+Number(value||0),0),0);
  const dayBeforeStart=new Date(`${periodStart}T00:00:00Z`);dayBeforeStart.setUTCDate(dayBeforeStart.getUTCDate()-1);
  const openingBalances=balanceThrough(dayBeforeStart.toISOString().slice(0,10),daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans);
  const closingBalances=balanceThrough(new Date(Date.UTC(monthlySelectedYear,selectedMonth,0)).toISOString().slice(0,10),daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans);
  const expenseCategories=[...new Set([...settings.expenseCategories,...monthDaily.flatMap(entry=>Object.keys(entry.expenses||{}))])];
  const purchaseVendors=[...new Set([...settings.vendors,...monthPurchases.flatMap(entry=>Object.keys(entry.vendorAmounts||{}))])].filter(name=>name!=='Other'&&name!=='Transport').slice(0,10);
  const extraExpenseCategories=expenseCategories.slice(4);
  const allPurchaseCategories=[...new Set([...settings.vendors,...monthPurchases.flatMap(entry=>Object.keys(entry.vendorAmounts||{}))])].filter(name=>name!=='Other'&&name!=='Transport');
  const extraPurchaseCategories=[...allPurchaseCategories.slice(10),'Other','Transport'];
  const monthlySummaryValues:Record<string,number>={
    B5:monthDaily.reduce((total,entry)=>total+Number(entry.onlineSales||0),0),
    B6:monthDaily.reduce((total,entry)=>total+Number(entry.cashSales||0),0),
    B7:totalSales,
    B19:totalPurchases,
    B25:totalExpenses,
    B27:openingBalances.online,
    B28:closingBalances.online,
    B29:openingBalances.cash,
    B30:closingBalances.cash,
    B31:closingBalances.total,
    B33:totalSales-totalPurchases-totalExpenses
  };
  purchaseVendors.forEach((vendor,index)=>monthlySummaryValues[`B${9+index}`]=monthPurchases.reduce((total,entry)=>total+Number(entry.vendorAmounts?.[vendor]||0),0));
  expenseCategories.slice(0,4).forEach((category,index)=>monthlySummaryValues[`B${21+index}`]=monthDaily.reduce((total,entry)=>total+Number(entry.expenses?.[category]||0),0));
  const zip=await JSZip.loadAsync(template);
  const dailySheet=buildDailyXml(daily,settings.expenseCategories,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance);
  const purchaseSheet=buildPurchaseXml(purchases,settings.vendors);
  const dailySheetPath='xl/worksheets/sheet3.xml',purchaseSheetPath='xl/worksheets/sheet4.xml';
  const dailyTemplate=await zip.file(dailySheetPath)!.async('string'),purchaseTemplate=await zip.file(purchaseSheetPath)!.async('string');
  zip.file(dailySheetPath,replaceWorksheetData(dailyTemplate,dailySheet.xml,495));
  zip.file(purchaseSheetPath,replaceWorksheetData(purchaseTemplate,purchaseSheet.xml,503));
  const dailyTablePath='xl/tables/table1.xml',purchaseTablePath='xl/tables/table2.xml';
  zip.file(dailyTablePath,updateTableXml(await zip.file(dailyTablePath)!.async('string'),dailySheet.headers,dailySheet.lastColumn,Math.max(495,dailySheet.lastRow)));
  zip.file(purchaseTablePath,updateTableXml(await zip.file(purchaseTablePath)!.async('string'),purchaseSheet.headers,purchaseSheet.lastColumn,Math.max(503,purchaseSheet.lastRow)));
  const financeSheetLastRow=Math.max(4,await appendFinanceSheet(zip,finance));
  const financeRange=`'Additional Finance'!$E$4:$E$${financeSheetLastRow}`;
  const financeTypeRange=`'Additional Finance'!$A$4:$A$${financeSheetLastRow}`;
  const financePeriodRange=`'Additional Finance'!$B$4:$B$${financeSheetLastRow}`;
  const financeSum=(type:string,periodCriteria:string)=>`SUMIFS(${financeRange},${financeTypeRange},"${type}",${financePeriodRange},${periodCriteria})`;
  const monthlyFinanceExpensesFormula=['Salary','Truck EMI','Auto EMI','Room Rent'].map(type=>financeSum(type,'TEXT($B$3,"yyyy-mm")')).join('+')||'0';
  const monthlyLoanRepaymentsFormula=`SUMIFS(${financeRange},${financeTypeRange},"Loan Repayment",${financePeriodRange},">="&$B$3,${financePeriodRange},"<"&EDATE($B$3,1))`;
  const cumulativeFinanceOutflowFormula=['Salary','Truck EMI','Auto EMI','Room Rent','Savings Deposit'].map(type=>financeSum(type,'"<="&TEXT(EOMONTH($B$3,0),"yyyy-mm")')).join('+')||'0';
  const cumulativeLoanRepaymentsFormula=`SUMIFS(${financeRange},${financeTypeRange},"Loan Repayment",${financePeriodRange},"<="&EOMONTH($B$3,0))`;
  const cumulativeVendorCreditsFormula=`SUMIFS(${financeRange},${financeTypeRange},"Vendor Refund Received",${financePeriodRange},"<="&EOMONTH($B$3,0))`;
  const settingsPath='xl/worksheets/sheet6.xml';
  let sxml=await zip.file(settingsPath)!.async('string');
  const put = (ref:string,val:string) => { sxml=setWorksheetCell(sxml,ref,cellText(ref,val,'12')); };
  const putNum=(ref:string,val:number)=>{ sxml=setWorksheetCell(sxml,ref,cellNum(ref,val,'12')); };
  putNum('B3',settings.openingOnlineBalance); putNum('B4',settings.openingCashBalance);
  const existingSettings=settingsSlots(sxml);
  const vendorSlots=Math.max(settings.vendors.length,existingSettings.vendors);
  const expenseSlots=Math.max(settings.expenseCategories.length,existingSettings.expenses);
  for(let index=0;index<vendorSlots;index++) put(`A${7+index}`,settings.vendors[index]||'');
  for(let index=0;index<expenseSlots;index++) put(`C${7+index}`,settings.expenseCategories[index]||'');
  zip.file(settingsPath,sxml);
  const monthlySummaryPath='xl/worksheets/sheet5.xml';
  let summaryXml=await zip.file(monthlySummaryPath)!.async('string');
  summaryXml=setFormulaCell(summaryXml,'B19',`SUMIFS('Weekly Purchases'!$M$2:$M$503,'Weekly Purchases'!$A$2:$A$503,">="&$B$3,'Weekly Purchases'!$A$2:$A$503,"<"&EDATE($B$3,1))`);
  summaryXml=setFormulaCell(summaryXml,'B25',`SUMIFS('Daily Sales & Expenses'!$I$2:$I$495,'Daily Sales & Expenses'!$A$2:$A$495,">="&$B$3,'Daily Sales & Expenses'!$A$2:$A$495,"<"&EDATE($B$3,1))+(${monthlyFinanceExpensesFormula})+(${monthlyLoanRepaymentsFormula})`);
  summaryXml=setFormulaCell(summaryXml,'B31',`B28+B30-(${cumulativeFinanceOutflowFormula})-(${cumulativeLoanRepaymentsFormula})+(${cumulativeVendorCreditsFormula})`);
  for(let index=0;index<4;index++){
    const row=21+index,category=settings.expenseCategories[index]||'',column=excelColumn(4+index);
    summaryXml=setWorksheetCell(summaryXml,`A${row}`,cellText(`A${row}`,category,'12'));
    summaryXml=setFormulaCell(summaryXml,`B${row}`,`SUMIFS('Daily Sales & Expenses'!$${column}$2:$${column}$495,'Daily Sales & Expenses'!$A$2:$A$495,">="&$B$3,'Daily Sales & Expenses'!$A$2:$A$495,"<"&EDATE($B$3,1))`);
  }
  for(const [ref,value] of Object.entries(monthlySummaryValues)) summaryXml=setFormulaCache(summaryXml,ref,value);
  let additionalRow=35;
  if(extraExpenseCategories.length){
    summaryXml=setWorksheetCell(summaryXml,`A${additionalRow}`,cellText(`A${additionalRow}`,'Additional Expense Categories','5'));
    additionalRow++;
    for(const [index,category] of extraExpenseCategories.entries()){
      const row=additionalRow++,column=excelColumn(16+index),value=monthDaily.reduce((total,entry)=>total+Number(entry.expenses?.[category]||0),0);
      summaryXml=setWorksheetCell(summaryXml,`A${row}`,cellText(`A${row}`,category,'12'));
      summaryXml=setFormulaCell(summaryXml,`B${row}`,`SUMIFS('Daily Sales & Expenses'!$${column}$2:$${column}$495,'Daily Sales & Expenses'!$A$2:$A$495,">="&$B$3,'Daily Sales & Expenses'!$A$2:$A$495,"<"&EDATE($B$3,1))`,value);
    }
  }
  if(monthFinance){
    const financeRows=[['Monthly salary',monthlySalary],['Truck EMI',Number(monthFinance.truckEmi||0)],['Auto EMI',Number(monthFinance.autoEmi||0)],['Room rent',Number(monthFinance.roomRent||0)],['Loan repayments',monthlyLoanRepayments],['Savings deposited',Number(monthFinance.savingsDeposit||0)],['Partner payouts from savings',(monthFinance.partnerPayments||[]).reduce((total,payment)=>total+Number(payment.amount||0),0)]] as const;
    summaryXml=setWorksheetCell(summaryXml,`A${additionalRow}`,cellText(`A${additionalRow}`,'Monthly Finance','5'));
    additionalRow++;
    for(const [label,value] of financeRows){summaryXml=setWorksheetCell(summaryXml,`A${additionalRow}`,cellText(`A${additionalRow}`,label,'12'));summaryXml=setWorksheetCell(summaryXml,`B${additionalRow}`,cellNum(`B${additionalRow}`,value,'12'));additionalRow++;}
  }
  if(extraPurchaseCategories.length){
    summaryXml=setWorksheetCell(summaryXml,`A${additionalRow}`,cellText(`A${additionalRow}`,'Additional Purchase Categories','5'));
    additionalRow++;
    for(const [index,category] of extraPurchaseCategories.entries()){
      const row=additionalRow++,column=excelColumn(16+index),value=monthPurchases.reduce((total,entry)=>total+Number(entry.vendorAmounts?.[category]||0),0);
      summaryXml=setWorksheetCell(summaryXml,`A${row}`,cellText(`A${row}`,category,'12'));
      summaryXml=setFormulaCell(summaryXml,`B${row}`,`SUMIFS('Weekly Purchases'!$${column}$2:$${column}$503,'Weekly Purchases'!$A$2:$A$503,">="&$B$3,'Weekly Purchases'!$A$2:$A$503,"<"&EDATE($B$3,1))`,value);
    }
  }
  zip.file(monthlySummaryPath,summaryXml);
  const dailyLimit=Math.max(495,daily.length+1),purchaseLimit=Math.max(503,purchases.length+1);
  for(const name of Object.keys(zip.files).filter(file=>/^xl\/(worksheets|charts)\/.*\.xml$/.test(file))){
    const file=zip.file(name);if(!file)continue;
    const xml=await file.async('string');
    zip.file(name,xml.replace(/\$495\b/g,`$${dailyLimit}`).replace(/\$503\b/g,`$${purchaseLimit}`));
  }
  const dashboardPath='xl/worksheets/sheet1.xml';
  let dashboardXml=await zip.file(dashboardPath)!.async('string');
  const latestDaily=daily.at(-1);
  if(latestDaily){
    const latestExpenses=Object.values(latestDaily.expenses||{}).reduce((total,value)=>total+Number(value||0),0);
    const latestBalances=balanceThrough(latestDaily.date,daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans);
    const latestSales=Number(latestDaily.onlineSales||0)+Number(latestDaily.cashSales||0);
    const monthlyDashboardCaches:Record<string,number>={A6:monthlySummaryValues.B5,D6:monthlySummaryValues.B6,G6:monthlySummaryValues.B7,A9:totalPurchases,D9:totalExpenses,G9:closingBalances.online,A12:closingBalances.cash,D12:closingBalances.total,G12:totalSales-totalPurchases-totalExpenses,B16:latestSales,C16:latestExpenses,D16:latestSales-latestExpenses,E16:latestBalances.total,H16:excelSerial(latestDaily.date)||0};
    for(const [ref,value] of Object.entries(monthlyDashboardCaches)) dashboardXml=setFormulaCache(dashboardXml,ref,value);
  }
  zip.file(dashboardPath,dashboardXml);
  const yearlySheet=templateWorkbook.Sheets['Yearly Dashboard'];
  const selectedYearlyYear=Number(yearlySheet?.B3?.v)||new Date().getFullYear();
  let yearlyXml=await zip.file('xl/worksheets/sheet2.xml')!.async('string');
  for(let month=1;month<=12;month++){
    const start=`${selectedYearlyYear}-${String(month).padStart(2,'0')}-01`;
    const end=new Date(Date.UTC(selectedYearlyYear,month,1)).toISOString().slice(0,10);
    const monthDaily=daily.filter(entry=>entry.date>=start&&entry.date<end);
    const monthPurchases=purchases.filter(entry=>entry.purchaseDate>=start&&entry.purchaseDate<end);
    const sales=monthDaily.reduce((total,entry)=>total+Number(entry.onlineSales||0)+Number(entry.cashSales||0),0);
    const monthlyRecord=(finance.months||[]).find(entry=>entry.period===`${selectedYearlyYear}-${String(month).padStart(2,'0')}`);
    const loanRepayments=(finance.loans||[]).flatMap(loan=>loan.repayments||[]).filter(repayment=>repayment.date>=start&&repayment.date<end).reduce((total,repayment)=>total+Number(repayment.amount||0),0);
    const expenses=monthDaily.reduce((total,entry)=>total+Object.values(entry.expenses||{}).reduce((amount,value)=>amount+Number(value||0),0),0)+(monthlyRecord?.salaries||[]).reduce((total,salary)=>total+Number(salary.amount||0),0)+Number(monthlyRecord?.truckEmi||0)+Number(monthlyRecord?.autoEmi||0)+Number(monthlyRecord?.roomRent||0)+loanRepayments;
    const purchasesTotal=monthPurchases.reduce((total,entry)=>total+Object.values(entry.vendorAmounts||{}).reduce((amount,value)=>amount+Number(value||0),0),0);
    const balances=balanceThrough(new Date(Date.UTC(selectedYearlyYear,month,0)).toISOString().slice(0,10),daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans);
    const row=5+month;
    for(const [column,value] of [['B',sales],['C',purchasesTotal],['D',expenses],['E',sales-purchasesTotal-expenses],['F',balances.total]] as const) yearlyXml=setFormulaCache(yearlyXml,`${column}${row}`,value);
    const yearPeriodCriteria=`TEXT(DATE($B$3,${month},1),"yyyy-mm")`;
    const yearlyOperationsExpenses=['Salary','Truck EMI','Auto EMI','Room Rent'].map(type=>`SUMIFS(${financeRange},${financeTypeRange},"${type}",${financePeriodRange},${yearPeriodCriteria})`).join('+')||'0';
    const yearlyLoanRepayments=`SUMIFS(${financeRange},${financeTypeRange},"Loan Repayment",${financePeriodRange},">="&DATE($B$3,${month},1),${financePeriodRange},"<"&EDATE(DATE($B$3,${month},1),1))`;
    const dailyExpenseFormula=`SUMIFS('Daily Sales & Expenses'!$I$2:$I$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},">="&DATE($B$3,${month},1),'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},"<"&EDATE(DATE($B$3,${month},1),1))`;
    yearlyXml=setFormulaCell(yearlyXml,`D${row}`,`${dailyExpenseFormula}+${yearlyOperationsExpenses}+${yearlyLoanRepayments}`,expenses);
    yearlyXml=setFormulaCell(yearlyXml,`E${row}`,`B${row}-C${row}-D${row}`,sales-purchasesTotal-expenses);
    const originalBalanceFormula=String(yearlySheet?.[`F${row}`]?.f||'').replace(/\$495\b/g,`$${dailyLimit}`).replace(/\$503\b/g,`$${purchaseLimit}`);
    const yearlyFinanceOutflow=['Salary','Truck EMI','Auto EMI','Room Rent','Savings Deposit'].map(type=>`SUMIFS(${financeRange},${financeTypeRange},"${type}",${financePeriodRange},"<="&TEXT(DATE($B$3,${month}+1,0),"yyyy-mm"))`).join('+')||'0';
    const yearlyLoanOutflow=`SUMIFS(${financeRange},${financeTypeRange},"Loan Repayment",${financePeriodRange},"<="&DATE($B$3,${month}+1,0))`;
    const yearlyRefunds=`SUMIFS(${financeRange},${financeTypeRange},"Vendor Refund Received",${financePeriodRange},"<="&DATE($B$3,${month}+1,0))`;
    yearlyXml=setFormulaCell(yearlyXml,`F${row}`,`${originalBalanceFormula}-(${yearlyFinanceOutflow})-(${yearlyLoanOutflow})+(${yearlyRefunds})`,balances.total);
  }
  zip.file('xl/worksheets/sheet2.xml',yearlyXml);
  const wbXml=await zip.file('xl/workbook.xml')!.async('string');
  const calcPr = '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';
  const wbPatched = wbXml.includes('<calcPr') ? wbXml.replace(/<calcPr[^>]*\/>/, calcPr) : wbXml.replace('</workbook>', calcPr + '</workbook>');
  zip.file('xl/workbook.xml', wbPatched);
  return zip.generateAsync({type:'nodebuffer'});
}

export async function exportWorkbook(): Promise<Buffer> {
  const db=await getDb();
  const business = await db.collection<{_id:string;name?:string;openingOnlineBalance?:number;openingCashBalance?:number;vendors?:string[];expenseCategories?:string[]}>('businesses').findOne({_id:BUSINESS_ID});
  const daily=await db.collection<DailyEntry>('dailyEntries').find({businessId:BUSINESS_ID}).sort({date:1}).toArray();
  const purchases=await db.collection<PurchaseEntry>('purchaseEntries').find({businessId:BUSINESS_ID}).sort({purchaseDate:1}).toArray();
  const [financeMonths,loans,vendorReturns]=await Promise.all([
    db.collection<FinanceMonth>('monthlyFinance').find({businessId:BUSINESS_ID}).sort({period:1}).toArray(),
    db.collection<FinanceLoan>('financeLoans').find({businessId:BUSINESS_ID}).sort({takenDate:1}).toArray(),
    db.collection<VendorDefectReturn>('vendorDefectReturns').find({businessId:BUSINESS_ID}).sort({returnDate:1}).toArray()
  ]);
    const settings: BusinessSettings={name:business?.name||'CONIC',currency:'INR',dateFormat:'DD-MMM-YYYY',openingOnlineBalance:Number(business?.openingOnlineBalance||0),openingCashBalance:Number(business?.openingCashBalance||0),vendors:Array.isArray(business?.vendors)&&business.vendors.length?business.vendors:DEFAULT_VENDORS,expenseCategories:Array.isArray(business?.expenseCategories)&&business.expenseCategories.length?business.expenseCategories:DEFAULT_EXPENSE_CATEGORIES};
  const template=fs.readFileSync(path.join(process.cwd(),'data/templates/CONIC_Business_Tracker.xlsx'));
  return buildWorkbookFromData(template,daily,purchases,settings,{months:financeMonths,loans,vendorReturns});
}
