export interface Profile {
  id: string
  nickname: string
  avatarUrl: string
}

export interface MatchSummary {
  id: string
  finishedAt: string
  playerCount: number
  gameMode: string
  targetCoef: number | null
  randomTargetCoef: boolean | null
  startingCoef: number | null
  admitted: boolean
  eliminationOrder: number | null
}

export interface StartingTrait {
  type: string
  value: string
  coef: number
}

export interface MatchDetail extends MatchSummary {
  characteristics: StartingTrait[]
}
