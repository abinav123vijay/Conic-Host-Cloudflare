import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/mongodb';
import { calculateBalancesThrough as balanceThrough } from '@/lib/finance/balances';
import { BUSINESS_ID, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS, MONTHS } from '@/lib/constants';
import type { BusinessSettings, DailyEntry, FinanceLoan, FinanceMonth, PurchaseEntry, VendorDefectReturn } from '@/types/domain';

type AdditionalFinanceData = { months?: FinanceMonth[]; loans?: FinanceLoan[]; vendorReturns?: VendorDefectReturn[] };
type FinanceSheetRow = { type: string; dateOrPeriod: string | number; paymentDate?: string; name: string; source: string; amount: number; received: number; outstanding: number; notes: string; recordId: string };

function excelSerial(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Math.floor((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}
function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function cellNum(ref: string, value: number | null, style?: string) { return value === null ? '' : `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`; }
function cellText(ref: string, value: string, style?: string) { return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t>${esc(value)}</t></is></c>`; }
function cellFormula(ref: string, formula: string, cachedValue?: number, style?: string) { return `<c r="${ref}"${style ? ` s="${style}"` : ''}><f>${esc(formula)}</f>${cachedValue === undefined ? '' : `<v>${cachedValue}</v>`}</c>`; }
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
function setCalcCachedText(xml:string,ref:string,value:string){
  const escapedRef=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`(<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*)(>[\\s\\S]*?<\\/c>)`);
  const match=pattern.exec(xml);
  if(!match) return xml;
  const attributes=/\st="[^"]*"/.test(match[1])?match[1].replace(/\st="[^"]*"/,' t="str"'):`${match[1]} t="str"`;
  const body=/<v\b[^>]*>[\s\S]*?<\/v>/.test(match[2])?match[2].replace(/<v\b[^>]*>[\s\S]*?<\/v>/,`<v>${esc(value)}</v>`):match[2].replace('</c>',`<v>${esc(value)}</v></c>`);
  return xml.replace(pattern,()=>`${attributes}${body}`);
}
function setCellValue(xml:string,ref:string,value:string|number){
  const escapedRef=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`(<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*)(?:>[\\s\\S]*?<\\/c>|\\s*\\/>)`);
  const match=pattern.exec(xml);
  if(!match) return xml;
  const attributes=match[1].replace(/\s+t="[^"]*"/,'');
  const content=typeof value==='string'?` t="inlineStr"><is><t>${esc(value)}</t></is></c>`:`><v>${value}</v></c>`;
  return xml.replace(pattern,()=>`${attributes}${content}`);
}
function refreshChartCaches(xml:string,calcValues:Map<string,string|number>){
  return xml.replace(/<c:(numRef|strRef)>[\s\S]*?<\/c:\1>/g,reference=>{
    const formula=/<c:f>([\s\S]*?)<\/c:f>/.exec(reference)?.[1];
    const range=formula&&/^Calc!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(formula);
    if(!range) return reference;
    const [,firstColumn,firstRow,lastColumn,lastRow]=range;
    const startRow=Number(firstRow),endRow=Number(lastRow);
    const values:string[]=[];
    for(let row=startRow;row<=endRow;row++){
      const value=calcValues.get(`${firstColumn}${row}`);
      if(value===undefined) return reference;
      values.push(String(value));
    }
    const cacheName=reference.startsWith('<c:numRef>')?'numCache':'strCache';
    const cachePattern=new RegExp(`<c:${cacheName}>[\\s\\S]*?<\\/c:${cacheName}>`);
    const oldCache=cachePattern.exec(reference)?.[0];
    if(!oldCache) return reference;
    const formatCode=/<c:formatCode>[\s\S]*?<\/c:formatCode>/.exec(oldCache)?.[0]||'';
    const points=values.map((value,index)=>`<c:pt idx="${index}"><c:v>${cacheName==='numCache'?value:esc(value)}</c:v></c:pt>`).join('');
    const cache=`<c:${cacheName}>${formatCode}<c:ptCount val="${values.length}"/>${points}</c:${cacheName}>`;
    return reference.replace(cachePattern,()=>cache);
  });
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
    const [year,monthNumber]=period.split('-').map(Number);
    const periodEnd=new Date(Date.UTC(year,monthNumber,0)).toISOString().slice(0,10);
    for(const salary of month.salaries||[]) records.push({type:'Salary',dateOrPeriod:period,paymentDate:salary.paymentDate||periodEnd,name:salary.person,source:'',amount:Number(salary.amount||0),received:0,outstanding:0,notes:'',recordId:''});
    for(const [type,amount,paymentDate] of [
      ['Truck EMI',month.truckEmi,month.truckEmiPaymentDate||periodEnd],
      ['Auto EMI',month.autoEmi,month.autoEmiPaymentDate||periodEnd],
      ['Room Rent',month.roomRent,periodEnd],
      ['Savings Deposit',month.savingsDeposit,periodEnd]
    ] as const) records.push({type,dateOrPeriod:period,paymentDate,name:'',source:'',amount:Number(amount||0),received:0,outstanding:0,notes:'',recordId:''});
    for(const entry of month.savingsEntries||[]) records.push({type:'Dated Savings Deposit',dateOrPeriod:excelSerial(entry.date)||0,paymentDate:entry.date,name:'',source:'Savings',amount:Number(entry.amount||0),received:0,outstanding:0,notes:entry.note||'',recordId:''});
    for(const payment of month.partnerPayments||[]) records.push({type:'Partner Payout',dateOrPeriod:period,paymentDate:payment.paymentDate||periodEnd,name:payment.partner,source:'Savings',amount:Number(payment.amount||0),received:0,outstanding:0,notes:'Quarterly payout from savings',recordId:''});
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
  const headers=['Record Type','Month / Date','Person / Vendor','Source','Amount','Repaid / Received','Remaining / Pending','Notes','Related Record ID','Payment Date'];
  const tableHeader=`<row r="3">${headers.map((header,index)=>cellText(`${excelColumn(index)}3`,header,'5')).join('')}</row>`;
  const rows=records.map((record,index)=>{const row=index+4;const dateCell=typeof record.dateOrPeriod==='number'?cellNum(`B${row}`,record.dateOrPeriod,'17'):cellText(`B${row}`,record.dateOrPeriod,'12');return `<row r="${row}">${[cellText(`A${row}`,record.type,'12'),dateCell,cellText(`C${row}`,record.name,'12'),cellText(`D${row}`,record.source,'12'),cellNum(`E${row}`,record.amount,'18'),cellNum(`F${row}`,record.received,'18'),cellNum(`G${row}`,record.outstanding,'18'),cellText(`H${row}`,record.notes,'12'),cellText(`I${row}`,record.recordId,'12'),cellNum(`J${row}`,excelSerial(record.paymentDate),'17')].join('')}</row>`;}).join('');
  const lastRow=Math.max(3,records.length+3);
  return {xml:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:J${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData><row r="1">${cellText('A1','Additional Finance & Liabilities','5')}</row><row r="2">${cellText('A2','Finance costs, savings deposits, and loan repayments reduce online balance. Borrowed loan amounts are liabilities, not available balance.','12')}</row>${tableHeader}${rows}</sheetData></worksheet>`,lastRow};
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

function buildDailyXml(entries: DailyEntry[], expenseCategories: string[], purchases: PurchaseEntry[], opening: { online: number; cash: number }, finance:AdditionalFinanceData, dailyLimit:number, purchaseLimit:number, financeSheetLastRow:number) {
  const categories = [...new Set([...expenseCategories, ...entries.flatMap(entry => Object.keys(entry.expenses || {}))])];
  const fixedCategories = categories.slice(0, 4);
  const overflowCategories = categories.slice(4);
  const financeEnd=financeSheetLastRow;
  const financeSum=(type:string,dateColumn:'B'|'J',dateCriteria:string)=>`SUMIFS('Additional Finance'!$E$4:$E$${financeEnd},'Additional Finance'!$A$4:$A$${financeEnd},"${type}",'Additional Finance'!$${dateColumn}$4:$${dateColumn}$${financeEnd},${dateCriteria})`;
  const onlinePurchaseOutflow=(row:number)=>`SUMIFS('Weekly Purchases'!$N$2:$N$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<>",'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<="&$A${row})+SUMIFS('Weekly Purchases'!$N$2:$N$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"",'Weekly Purchases'!$A$2:$A$${purchaseLimit},"<="&$A${row})`;
  const cashPurchaseOutflow=(row:number)=>`SUMIFS('Weekly Purchases'!$O$2:$O$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<>",'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<="&$A${row})+SUMIFS('Weekly Purchases'!$O$2:$O$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"",'Weekly Purchases'!$A$2:$A$${purchaseLimit},"<="&$A${row})`;
  const rows = Array.from({length:dailyLimit-1},(_,index)=>{
    const r=index+2,e=entries[index];
    const totalSales=Number(e?.onlineSales||0)+Number(e?.cashSales||0);
    const totalExpenses=Object.values(e?.expenses||{}).reduce((sum,value)=>sum+Number(value||0),0);
    const balances=e?balanceThrough(e.date,entries,purchases,opening,finance.months,finance.vendorReturns,finance.loans):undefined;
    const expenseFormulaRanges=[`E${r}:H${r}`,...overflowCategories.map((_,i)=>`${excelColumn(16+i)}${r}`)];
    const expenseFormula=`IF($A${r}="","",SUM(${expenseFormulaRanges.join(',')}))`;
    const totalSalesFormula=`IF($A${r}="","",SUM(B${r}:C${r}))`;
    const financeCriteria=`"<="&$A${r}`;
    const financeOutflowFormula=['Salary','Truck EMI','Auto EMI','Room Rent','Savings Deposit','Dated Savings Deposit'].map(type=>financeSum(type,'J',financeCriteria)).join('+')||'0';
    const loanRepaymentsFormula=financeSum('Loan Repayment','B',financeCriteria);
    const refundReceiptsFormula=financeSum('Vendor Refund Received','B',financeCriteria);
    const onlineBalanceFormula=`IF($A${r}="","",Settings!$B$3+SUMIFS($B$2:$B$${dailyLimit},$A$2:$A$${dailyLimit},"<="&$A${r})-SUMIFS($J$2:$J$${dailyLimit},$A$2:$A$${dailyLimit},"<="&$A${r})-(${onlinePurchaseOutflow(r)})-(${financeOutflowFormula})-(${loanRepaymentsFormula}))`;
    const cashBalanceFormula=`IF($A${r}="","",Settings!$B$4+SUMIFS($C$2:$C$${dailyLimit},$A$2:$A$${dailyLimit},"<="&$A${r})-SUMIFS($K$2:$K$${dailyLimit},$A$2:$A$${dailyLimit},"<="&$A${r})-(${cashPurchaseOutflow(r)}))`;
    const cells=[
      ...(e?[cellNum(`A${r}`,excelSerial(e.date),'17'),cellNum(`B${r}`,e.onlineSales,'18'),cellNum(`C${r}`,e.cashSales,'18')]:[]),
      cellFormula(`D${r}`,totalSalesFormula,e?totalSales:undefined,'15'),
      ...fixedCategories.map((name,i)=>e?cellNum(`${excelColumn(4+i)}${r}`,Number(e.expenses?.[name]||0),'18'): ''),
      ...Array.from({length:Math.max(0,4-fixedCategories.length)},(_,i)=>e?cellNum(`${excelColumn(4+fixedCategories.length+i)}${r}`,0,'18'):''),
      cellFormula(`I${r}`,expenseFormula,e?totalExpenses:undefined,'15'),
      ...(e?[cellNum(`J${r}`,e.expensePaidOnline,'15'),cellNum(`K${r}`,e.expensePaidCash,'15')]:[]),
      cellFormula(`L${r}`,onlineBalanceFormula,balances?.online,'15'),
      cellFormula(`M${r}`,cashBalanceFormula,balances?.cash,'15'),
      cellFormula(`N${r}`,`IF($A${r}="","",L${r}+M${r}+(${refundReceiptsFormula}))`,balances?.total,'15'),
      cellFormula(`O${r}`,`IF($A${r}="","",D${r}-I${r})`,e?totalSales-totalExpenses:undefined,'15'),
      ...(e?[cellText(`P${r}`,e.notes||'')]:[]),
      ...overflowCategories.map((name,i)=>e?cellNum(`${excelColumn(16+i)}${r}`,Number(e.expenses?.[name]||0),'18'):'')
    ];
    return `<row r="${r}">${cells.join('')}</row>`;
  }).join('');
  const headers=['Date','Online Sales','Cash Sales','Total Sales',...fixedCategories,...Array.from({length:Math.max(0,4-fixedCategories.length)},()=>''),'Total Expenses','Expense Paid Online','Expense Paid Cash','Online Balance','Cash Balance','Total Balance','Daily Net Amount','Notes',...overflowCategories];
  const header=`<row r="1">${headers.map((x,i)=>cellText(`${excelColumn(i)}1`,x,'5')).join('')}</row>`;
  const lastRow=dailyLimit,lastColumn=excelColumn(Math.max(15,15+overflowCategories.length));
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${header}${rows}</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`;
  return {xml,headers,lastRow,lastColumn};
}
function buildPurchaseXml(entries: PurchaseEntry[], vendors: string[], purchaseLimit:number) {
  const allCategories = [...new Set([...vendors, ...entries.flatMap(entry=>Object.keys(entry.vendorAmounts||{}))])].filter(name=>name!=='Other'&&name!=='Transport');
  const fixedVendors=allCategories.slice(0,10);
  const overflowCategories=[...allCategories.slice(10),'Other','Transport'];
  const rows = Array.from({length:purchaseLimit-1},(_,index)=>{
    const r=index+2,e=entries[index];
    const total=Object.values(e?.vendorAmounts||{}).reduce((sum,value)=>sum+Number(value||0),0);
    const pending=Math.max(0,total-Number(e?.onlinePurchasePaid||0)-Number(e?.cashPurchasePaid||0));
    const totalRanges=[`C${r}:L${r}`,...overflowCategories.map((_,i)=>`${excelColumn(16+i)}${r}`)];
    const cells=[
      ...(e?[cellNum(`A${r}`,excelSerial(e.purchaseDate),'17'),cellNum(`B${r}`,excelSerial(e.paymentDate),'17')]:[]),
      ...fixedVendors.map((name,i)=>e?cellNum(`${excelColumn(2+i)}${r}`,Number(e.vendorAmounts?.[name]||0),'18'):''),
      ...Array.from({length:Math.max(0,10-fixedVendors.length)},(_,i)=>e?cellNum(`${excelColumn(2+fixedVendors.length+i)}${r}`,0,'18'):''),
      cellFormula(`M${r}`,`IF($A${r}="","",SUM(${totalRanges.join(',')}))`,e?total:undefined,'15'),
      ...(e?[cellNum(`N${r}`,Number(e.onlinePurchasePaid||0),'15'),cellNum(`O${r}`,Number(e.cashPurchasePaid||0),'18')]:[]),
      cellFormula(`P${r}`,`IF($A${r}="","",MAX(0,M${r}-N${r}-O${r}))`,e?pending:undefined,'15'),
      ...overflowCategories.map((name,i)=>e?cellNum(`${excelColumn(16+i)}${r}`,Number(e.vendorAmounts?.[name]||0),'18'):'')
    ];
    return `<row r="${r}">${cells.join('')}</row>`;
  }).join('');
  const headers=['Purchase Date','Payment Date',...fixedVendors,...Array.from({length:Math.max(0,10-fixedVendors.length)},()=>''),'Total Weekly Purchase','Online Purchase Paid','Cash Purchase Paid','Pending Purchase',...overflowCategories];
  const header=`<row r="1">${headers.map((x,i)=>cellText(`${excelColumn(i)}1`,x,'5')).join('')}</row>`;
  const lastRow=purchaseLimit,lastColumn=excelColumn(Math.max(15,15+overflowCategories.length));
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${header}${rows}</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`;
  return {xml,headers,lastRow,lastColumn};
}

export async function buildWorkbookFromData(template:Buffer,daily:DailyEntry[],purchases:PurchaseEntry[],settings:BusinessSettings,finance:AdditionalFinanceData={}):Promise<Buffer>{
  const templateWorkbook=XLSX.read(template,{cellDates:true});
  const dashboard=templateWorkbook.Sheets['Monthly Dashboard'];
  const yearlyDashboard=templateWorkbook.Sheets['Yearly Dashboard'];
  const activityDates=[
    ...daily.map(entry=>entry.date),
    ...purchases.flatMap(entry=>[entry.purchaseDate,entry.paymentDate].filter((date):date is string=>Boolean(date))),
    ...(finance.months||[]).map(month=>/^\d{4}-\d{2}$/.test(month.period)?`${month.period}-01`: ''),
    ...(finance.loans||[]).flatMap(loan=>[loan.takenDate,...(loan.repayments||[]).map(item=>item.date)]),
    ...(finance.vendorReturns||[]).flatMap(item=>[item.returnDate,...(item.receipts||[]).map(receipt=>receipt.date)])
  ].filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const latestActivityDate=activityDates.at(-1);
  const monthlySelectedYear=latestActivityDate?Number(latestActivityDate.slice(0,4)):Number(dashboard?.D3?.v)||new Date().getFullYear();
  const selectedMonth=latestActivityDate?Number(latestActivityDate.slice(5,7)):Math.max(1,MONTHS.indexOf(String(dashboard?.B3?.v))+1);
  const selectedYearlyYear=latestActivityDate?monthlySelectedYear:Number(yearlyDashboard?.B3?.v)||new Date().getFullYear();
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
  const dailyLimit=Math.max(495,daily.length+1),purchaseLimit=Math.max(503,purchases.length+1);
  const zip=await JSZip.loadAsync(template);
  const financeSheetLastRow=Math.max(4,await appendFinanceSheet(zip,finance));
  const dailySheet=buildDailyXml(daily,settings.expenseCategories,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance,dailyLimit,purchaseLimit,financeSheetLastRow);
  const purchaseSheet=buildPurchaseXml(purchases,settings.vendors,purchaseLimit);
  const dailySheetPath='xl/worksheets/sheet3.xml',purchaseSheetPath='xl/worksheets/sheet4.xml';
  const dailyTemplate=await zip.file(dailySheetPath)!.async('string'),purchaseTemplate=await zip.file(purchaseSheetPath)!.async('string');
  zip.file(dailySheetPath,replaceWorksheetData(dailyTemplate,dailySheet.xml,495));
  zip.file(purchaseSheetPath,replaceWorksheetData(purchaseTemplate,purchaseSheet.xml,503));
  const dailyTablePath='xl/tables/table1.xml',purchaseTablePath='xl/tables/table2.xml';
  zip.file(dailyTablePath,updateTableXml(await zip.file(dailyTablePath)!.async('string'),dailySheet.headers,dailySheet.lastColumn,Math.max(495,dailySheet.lastRow)));
  zip.file(purchaseTablePath,updateTableXml(await zip.file(purchaseTablePath)!.async('string'),purchaseSheet.headers,purchaseSheet.lastColumn,Math.max(503,purchaseSheet.lastRow)));
  const financeRange=`'Additional Finance'!$E$4:$E$${financeSheetLastRow}`;
  const financeTypeRange=`'Additional Finance'!$A$4:$A$${financeSheetLastRow}`;
  const financePeriodRange=`'Additional Finance'!$B$4:$B$${financeSheetLastRow}`;
  const financePaymentDateRange=`'Additional Finance'!$J$4:$J$${financeSheetLastRow}`;
  const financeSum=(type:string,periodCriteria:string)=>`SUMIFS(${financeRange},${financeTypeRange},"${type}",${financePeriodRange},${periodCriteria})`;
  const financeDatedSum=(type:string,dateCriteria:string)=>`SUMIFS(${financeRange},${financeTypeRange},"${type}",${financePaymentDateRange},${dateCriteria})`;
  const financeOutflowThrough=(dateCriteria:string)=>['Salary','Truck EMI','Auto EMI','Room Rent','Savings Deposit','Dated Savings Deposit'].map(type=>financeDatedSum(type,dateCriteria)).join('+')||'0';
  const loanRepaymentsThrough=(dateCriteria:string)=>`SUMIFS(${financeRange},${financeTypeRange},"Loan Repayment",${financePeriodRange},${dateCriteria})`;
  const vendorRefundsThrough=(dateCriteria:string)=>`SUMIFS(${financeRange},${financeTypeRange},"Vendor Refund Received",${financePeriodRange},${dateCriteria})`;
  const onlinePurchasePaymentsThrough=(dateCriteria:string)=>`SUMIFS('Weekly Purchases'!$N$2:$N$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<>",'Weekly Purchases'!$B$2:$B$${purchaseLimit},${dateCriteria})+SUMIFS('Weekly Purchases'!$N$2:$N$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"",'Weekly Purchases'!$A$2:$A$${purchaseLimit},${dateCriteria})`;
  const cashPurchasePaymentsThrough=(dateCriteria:string)=>`SUMIFS('Weekly Purchases'!$O$2:$O$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<>",'Weekly Purchases'!$B$2:$B$${purchaseLimit},${dateCriteria})+SUMIFS('Weekly Purchases'!$O$2:$O$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"",'Weekly Purchases'!$A$2:$A$${purchaseLimit},${dateCriteria})`;
  const onlineBalanceThrough=(dateCriteria:string)=>`Settings!$B$3+SUMIFS('Daily Sales & Expenses'!$B$2:$B$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},${dateCriteria})-SUMIFS('Daily Sales & Expenses'!$J$2:$J$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},${dateCriteria})-(${onlinePurchasePaymentsThrough(dateCriteria)})-(${financeOutflowThrough(dateCriteria)})-(${loanRepaymentsThrough(dateCriteria)})`;
  const cashBalanceThrough=(dateCriteria:string)=>`Settings!$B$4+SUMIFS('Daily Sales & Expenses'!$C$2:$C$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},${dateCriteria})-SUMIFS('Daily Sales & Expenses'!$K$2:$K$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},${dateCriteria})-(${cashPurchasePaymentsThrough(dateCriteria)})`;
  const monthlyFinanceExpensesFormula=['Salary','Truck EMI','Auto EMI','Room Rent'].map(type=>financeSum(type,'TEXT($B$3,"yyyy-mm")')).join('+')||'0';
  const monthlyLoanRepaymentsFormula=`SUMIFS(${financeRange},${financeTypeRange},"Loan Repayment",${financePeriodRange},">="&$B$3,${financePeriodRange},"<"&EDATE($B$3,1))`;
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
  summaryXml=setFormulaCell(summaryXml,'B19',`SUMIFS('Weekly Purchases'!$M$2:$M$${purchaseLimit},'Weekly Purchases'!$A$2:$A$${purchaseLimit},">="&$B$3,'Weekly Purchases'!$A$2:$A$${purchaseLimit},"<"&EDATE($B$3,1))`);
  summaryXml=setFormulaCell(summaryXml,'B25',`SUMIFS('Daily Sales & Expenses'!$I$2:$I$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},">="&$B$3,'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},"<"&EDATE($B$3,1))+(${monthlyFinanceExpensesFormula})+(${monthlyLoanRepaymentsFormula})`);
  summaryXml=setFormulaCell(summaryXml,'B27',onlineBalanceThrough('"<"&$B$3'));
  summaryXml=setFormulaCell(summaryXml,'B28',onlineBalanceThrough('"<"&EDATE($B$3,1)'));
  summaryXml=setFormulaCell(summaryXml,'B29',cashBalanceThrough('"<"&$B$3'));
  summaryXml=setFormulaCell(summaryXml,'B30',cashBalanceThrough('"<"&EDATE($B$3,1)'));
  summaryXml=setFormulaCell(summaryXml,'B31',`B28+B30+(${vendorRefundsThrough('"<"&EDATE($B$3,1)')})`);
  for(let index=0;index<4;index++){
    const row=21+index,category=settings.expenseCategories[index]||'',column=excelColumn(4+index);
    summaryXml=setWorksheetCell(summaryXml,`A${row}`,cellText(`A${row}`,category,'12'));
    summaryXml=setFormulaCell(summaryXml,`B${row}`,`SUMIFS('Daily Sales & Expenses'!$${column}$2:$${column}$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},">="&$B$3,'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},"<"&EDATE($B$3,1))`);
  }
  for(const [ref,value] of Object.entries(monthlySummaryValues)) summaryXml=setFormulaCache(summaryXml,ref,value);
  let additionalRow=35;
  if(extraExpenseCategories.length){
    summaryXml=setWorksheetCell(summaryXml,`A${additionalRow}`,cellText(`A${additionalRow}`,'Additional Expense Categories','5'));
    additionalRow++;
    for(const [index,category] of extraExpenseCategories.entries()){
      const row=additionalRow++,column=excelColumn(16+index),value=monthDaily.reduce((total,entry)=>total+Number(entry.expenses?.[category]||0),0);
      summaryXml=setWorksheetCell(summaryXml,`A${row}`,cellText(`A${row}`,category,'12'));
      summaryXml=setFormulaCell(summaryXml,`B${row}`,`SUMIFS('Daily Sales & Expenses'!$${column}$2:$${column}$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},">="&$B$3,'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},"<"&EDATE($B$3,1))`,value);
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
  for(const name of Object.keys(zip.files).filter(file=>/^xl\/(worksheets|charts)\/.*\.xml$/.test(file))){
    const file=zip.file(name);if(!file)continue;
    const xml=await file.async('string');
    zip.file(name,xml.replace(/\$495\b/g,`$${dailyLimit}`).replace(/\$503\b/g,`$${purchaseLimit}`));
  }
  const dashboardPath='xl/worksheets/sheet1.xml';
  let dashboardXml=await zip.file(dashboardPath)!.async('string');
  const latestDaily=daily.at(-1);
  const latestExpenses=Object.values(latestDaily?.expenses||{}).reduce((total,value)=>total+Number(value||0),0);
  const latestBalances=latestDaily?balanceThrough(latestDaily.date,daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans):closingBalances;
  const latestSales=Number(latestDaily?.onlineSales||0)+Number(latestDaily?.cashSales||0);
  const monthlyDashboardCaches:Record<string,number>={A6:monthlySummaryValues.B5,D6:monthlySummaryValues.B6,G6:monthlySummaryValues.B7,A9:totalPurchases,D9:totalExpenses,G9:closingBalances.online,A12:closingBalances.cash,D12:closingBalances.total,G12:totalSales-totalPurchases-totalExpenses,B16:latestSales,C16:latestExpenses,D16:latestSales-latestExpenses,E16:latestBalances.total,H16:latestDaily?excelSerial(latestDaily.date)||0:0};
  for(const [ref,value] of Object.entries(monthlyDashboardCaches)) dashboardXml=setFormulaCache(dashboardXml,ref,value);
  zip.file(dashboardPath,dashboardXml);
  let yearlyXml=await zip.file('xl/worksheets/sheet2.xml')!.async('string');
  yearlyXml=setCellValue(yearlyXml,'B3',selectedYearlyYear);
  const calcValues=new Map<string,string|number>();
  const setCalcValue=(ref:string,value:string|number)=>{calcValues.set(ref,value);};
  let calcXml=await zip.file('xl/worksheets/sheet7.xml')!.async('string');
  const onlineSales=Number(monthlySummaryValues.B5||0),cashSales=Number(monthlySummaryValues.B6||0);
  for(const [ref,value] of Object.entries({D2:'Online Sales',D3:'Cash Sales',G2:'Sales',G3:'Purchases',G4:'Expenses'})) setCalcValue(ref,value);
  const chartSummaryValues:Record<string,number>={E2:onlineSales,E3:cashSales,H2:totalSales,H3:totalPurchases,H4:totalExpenses};
  for(const [ref,value] of Object.entries(chartSummaryValues)){calcXml=setFormulaCache(calcXml,ref,value);setCalcValue(ref,value);}
  for(let index=0;index<10;index++){
    const ref=`J${index+2}`,vendor=purchaseVendors[index]||'';
    calcXml=setCalcCachedText(calcXml,ref,vendor);
    setCalcValue(ref,vendor);
    const amount=vendor?monthPurchases.reduce((total,entry)=>total+Number(entry.vendorAmounts?.[vendor]||0),0):0;
    const amountRef=`K${index+2}`;
    calcXml=setFormulaCache(calcXml,amountRef,amount);
    setCalcValue(amountRef,amount);
  }
  let annualSales=0,annualPurchases=0,annualExpenses=0,annualNet=0;
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
    annualSales+=sales;annualPurchases+=purchasesTotal;annualExpenses+=expenses;annualNet+=sales-purchasesTotal-expenses;
    const balances=balanceThrough(new Date(Date.UTC(selectedYearlyYear,month,0)).toISOString().slice(0,10),daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans);
    const row=5+month;
    for(const [column,value] of [['B',sales],['C',purchasesTotal],['D',expenses],['E',sales-purchasesTotal-expenses],['F',balances.total]] as const) yearlyXml=setFormulaCache(yearlyXml,`${column}${row}`,value);
    for(const [column,value] of [['N',sales],['O',purchasesTotal],['P',expenses],['Q',sales-purchasesTotal-expenses],['R',balances.total]] as const) setCalcValue(`${column}${month+1}`,value);
    const yearPeriodCriteria=`TEXT(DATE($B$3,${month},1),"yyyy-mm")`;
    const yearlyOperationsExpenses=['Salary','Truck EMI','Auto EMI','Room Rent'].map(type=>`SUMIFS(${financeRange},${financeTypeRange},"${type}",${financePeriodRange},${yearPeriodCriteria})`).join('+')||'0';
    const yearlyLoanRepayments=`SUMIFS(${financeRange},${financeTypeRange},"Loan Repayment",${financePeriodRange},">="&DATE($B$3,${month},1),${financePeriodRange},"<"&EDATE(DATE($B$3,${month},1),1))`;
    const dailyExpenseFormula=`SUMIFS('Daily Sales & Expenses'!$I$2:$I$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},">="&DATE($B$3,${month},1),'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},"<"&EDATE(DATE($B$3,${month},1),1))`;
    yearlyXml=setFormulaCell(yearlyXml,`D${row}`,`${dailyExpenseFormula}+${yearlyOperationsExpenses}+${yearlyLoanRepayments}`,expenses);
    yearlyXml=setFormulaCell(yearlyXml,`E${row}`,`B${row}-C${row}-D${row}`,sales-purchasesTotal-expenses);
    const balanceDateCriteria=`"<"&EDATE(DATE($B$3,${month},1),1)`;
    yearlyXml=setFormulaCell(yearlyXml,`F${row}`,`${onlineBalanceThrough(balanceDateCriteria)}+${cashBalanceThrough(balanceDateCriteria)}+(${vendorRefundsThrough(balanceDateCriteria)})`,balances.total);
  }
  const annualClosing=balanceThrough(`${selectedYearlyYear}-12-31`,daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans);
  for(const [ref,value] of Object.entries({B18:annualSales,C18:annualPurchases,D18:annualExpenses,E18:annualNet,F18:annualClosing.total})) yearlyXml=setFormulaCache(yearlyXml,ref,value);
  zip.file('xl/worksheets/sheet2.xml',yearlyXml);
  for(let month=1;month<=12;month++) setCalcValue(`M${month+1}`,MONTHS[month-1]);
  for(const [ref,value] of calcValues) calcXml=typeof value==='number'?setFormulaCache(calcXml,ref,value):setCalcCachedText(calcXml,ref,value);
  zip.file('xl/worksheets/sheet7.xml',calcXml);
  dashboardXml=setCellValue(dashboardXml,'B3',MONTHS[selectedMonth-1]);
  dashboardXml=setCellValue(dashboardXml,'D3',monthlySelectedYear);
  zip.file(dashboardPath,dashboardXml);
  summaryXml=setFormulaCache(summaryXml,'B3',excelSerial(periodStart)||0);
  zip.file(monthlySummaryPath,summaryXml);
  for(const name of Object.keys(zip.files).filter(file=>/^xl\/charts\/chart\d+\.xml$/.test(file))){
    const chart=zip.file(name);
    if(chart) zip.file(name,refreshChartCaches(await chart.async('string'),calcValues));
  }
  const wbXml=await zip.file('xl/workbook.xml')!.async('string');
  const calcPr = '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';
  const wbPatched = wbXml.includes('<calcPr') ? wbXml.replace(/<calcPr[^>]*\/>/, calcPr) : wbXml.replace('</workbook>', calcPr + '</workbook>');
  zip.file('xl/workbook.xml', wbPatched);
  zip.remove('xl/calcChain.xml');
  const relationshipsPath='xl/_rels/workbook.xml.rels';
  const relationships=await zip.file(relationshipsPath)!.async('string');
  zip.file(relationshipsPath,relationships.replace(/<Relationship\b(?=[^>]*\bType="[^"]*\/calcChain")[^>]*\/>/g,''));
  const contentTypesPath='[Content_Types].xml';
  const contentTypes=await zip.file(contentTypesPath)!.async('string');
  zip.file(contentTypesPath,contentTypes.replace(/<Override\b(?=[^>]*\bPartName="\/xl\/calcChain\.xml")[^>]*\/>/g,''));
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
