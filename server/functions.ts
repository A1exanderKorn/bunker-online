import { Biology, Characteristic, ExcelRow } from "."
import cors from 'cors'
import * as XLSX from 'xlsx'
import fs from 'fs'

export async function loadCharacteristicsFromExcel(path: string): Promise<ExcelRow[]> {
  const workbook = XLSX.readFile(path)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet) as ExcelRow[]
  return rows
  
}

export function generateBiology(existing: Biology[]): Biology {
  const total = existing.length
  const hasAndroid = existing.some(b => b.sex === 'Андроид')
  const hasHerm = existing.some(b => b.sex === 'Гермафродит')

  const rand = Math.random() * 100

  let sex: 'М' | 'Ж' | 'Андроид' | 'Гермафродит'
  if (rand <= 1.75 && !hasHerm) sex = 'Гермафродит'
  else if (rand <= 1.75 + 2.75 && !hasAndroid) sex = 'Андроид'
  else sex = Math.random() < 0.5 ? 'М' : 'Ж'

  let age = Math.floor(Math.random() * (85 - 19 + 1)) + 19
  let experience = Math.floor((Math.random() * (age - 16.5)) * 2) / 2

  let coef = 0.5
  if (sex === 'Ж') {
    if (age <= 49) coef = 1.0 - 0.04 * Math.abs(33 - age)
    else coef = 0.4 - 0.01 * Math.abs(50 - age)
  } else if (sex === 'М') {
    if (age <= 59) coef = 1.0 - 0.03 * Math.abs(36 - age)
    else coef = 0.4 - 0.01 * Math.abs(60 - age)
  }

  let infertile = false
  if ((sex === 'Ж' && age <= 49) || (sex === 'М' && age <= 59)) {
    if (Math.random() < 0.25) {
      coef -= 0.4
      infertile = true
    }
  }
  if (sex === 'Андроид'){
    coef = 1.15
    age = Math.floor(Math.random() * (20))
    experience = age
  }
  if(sex === 'Гермафродит'){
    coef = 1.25
    age = Math.floor(Math.random() * (15)) + 25
    experience = Math.floor((Math.random() * (age - 16.5)) * 2) / 2
  }
  return { sex, age, experience, coef, infertile, isVisible: false }
}

export function parseExcelRow(row: any): Characteristic {
  return {
    type: row['Категория'],
    value: row['Название'],
    coef: row['КФ'],
    hint: row['Подсказка'],
    isVisible: false,
  };
  }

  export function pickWithBias<T extends { coef: number }>(
    candidates: T[],
    currentAvg: number,
    count: number
  ): T {
    const targetCoef = 0.5;
    const total = currentAvg * count;
    const desiredCoef = (targetCoef * (count + 1)) - total;

    const weights = candidates.map(c => {
    const diff = Math.abs(c.coef - desiredCoef);
    const weight = Math.max(0, 1 - diff); // линейный спад веса
    return { candidate: c, weight };
  });

  const filtered = weights.filter(w => w.weight > 0);
  if (filtered.length === 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const totalWeight = filtered.reduce((sum, w) => sum + w.weight, 0);
  let rnd = Math.random() * totalWeight;

  for (const { candidate, weight } of filtered) {
    if (rnd < weight) return candidate;
      rnd -= weight;
  }

  return filtered[0].candidate;
}
  
export function generateCharacteristics(
  rawData: ExcelRow[],
  usedValues: Set<string>,
  startingCoef: number,
  alreadyPicked: number
): {chosen: Characteristic, newCoef: number, usedValues: Set<string>} {
  const allData = rawData.map(parseExcelRow);
  const available = allData.filter(row => !usedValues.has(row.value));
  
  
  const chosen = pickWithBias(available, startingCoef, alreadyPicked);
  usedValues.add(chosen.value);
  const currentCoef = (startingCoef * alreadyPicked + chosen.coef) / (alreadyPicked + 1)
  
  return {chosen, newCoef: currentCoef, usedValues}
}

export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}