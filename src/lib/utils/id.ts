const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now = Date.now()): string {
	let time = '';
	for (let i = 9; i >= 0; i--) {
		time = ENCODING[now % 32] + time;
		now = Math.floor(now / 32);
	}
	let random = '';
	for (let i = 0; i < 16; i++) {
		random += ENCODING[Math.floor(Math.random() * 32)];
	}
	return time + random;
}
