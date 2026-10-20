let generation = 0;
export function dataEpoch(): number { return generation; }
export function advanceDataEpoch(): void { generation++; }
