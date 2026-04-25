export interface Raw5paisaRow {
  Exch?: string;
  ExchType?: string;
  Token?: number | string;
  LastRate?: number;
  LastQty?: number;
  TotalQty?: number;
  High?: number;
  Low?: number;
  OpenRate?: number;
  PClose?: number;
  AvgRate?: number;
  Time?: number;
  BidQty?: number;
  BidRate?: number;
  OffQty?: number;
  OffRate?: number;
  TBidQ?: number;
  TOffQ?: number;
  TickDt?: string;
  ChgPcnt?: number;
}
