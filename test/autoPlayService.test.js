import { jest } from "@jest/globals";

const events = [];
const keyboard = {
	toggleKey: jest.fn((key, type) => {
		events.push({ key, type, time: performance.now() });
	}),
};

jest.unstable_mockModule("keysender", () => ({
	Hardware: jest.fn(() => ({ keyboard })),
}));

const { AutoPlayService } = await import("../src/main/services/autoPlayService.js");

function createService(panelOverrides = {}, keyboardOverrides = {}) {
	const configService = {
		value: {
			panel: {
				speed: 1,
				delayNext: 0,
				longPressMode: false,
				...panelOverrides,
			},
			keyboard: {
				customKeyboard: false,
				keys: [],
				...keyboardOverrides,
			},
		},
	};

	const service = new AutoPlayService(configService);
	service._sleep = (ms) =>
		new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.ceil(ms))));

	return service;
}

function expectEventTimes(actual, expected, toleranceMs = 1) {
	expect(actual).toHaveLength(expected.length);
	expected.forEach((exp, index) => {
		expect(actual[index].key).toBe(exp.key);
		expect(actual[index].type).toBe(exp.type);
		expect(Math.abs(actual[index].time - exp.time)).toBeLessThanOrEqual(toleranceMs);
	});
}

describe("AutoPlayService timeline", () => {
	beforeAll(() => {
		jest.useFakeTimers();
		Object.defineProperty(global, "performance", {
			value: { now: () => Date.now() },
			configurable: true,
		});
	});

	afterAll(() => {
		jest.useRealTimers();
	});

	beforeEach(() => {
		events.length = 0;
		keyboard.toggleKey.mockClear();
		jest.setSystemTime(0);
	});

	it("plays key down/up on the expected timeline", async () => {
		const service = createService();
		service.state.isPlaying = true;
		service.state.sessionId = "s1";

		const keyMap = {
			1000: ["y"],
			2000: ["u"],
		};

		const playPromise = service._autoPlay(keyMap, "s1", 0);
		await jest.runAllTimersAsync();
		await playPromise;

		const calibration = 1.003;
		const expected = [
			{ key: "y", type: true, time: 1000 * calibration },
			{ key: "y", type: false, time: 1000 * calibration + 25 },
			{ key: "u", type: true, time: 2000 * calibration },
			{ key: "u", type: false, time: 2000 * calibration + 25 },
		];

		expectEventTimes(events, expected, 1);
	});

	it("uses delayNext for long press when there is no next step", async () => {
		const service = createService({ longPressMode: true, delayNext: 0.4 });
		service.state.isPlaying = true;
		service.state.sessionId = "s1";

		const keyMap = {
			1000: ["y"],
		};

		const playPromise = service._autoPlay(keyMap, "s1", 0);
		await jest.runAllTimersAsync();
		await playPromise;

		const calibration = 1.003;
		const expectedDown = 1000 * calibration;
		const expectedUp = expectedDown + 365;

		expectEventTimes(
			events,
			[
				{ key: "y", type: true, time: expectedDown },
				{ key: "y", type: false, time: expectedUp },
			],
			1
		);
	});

	it("applies speed changes without drifting timeline", async () => {
		const service = createService({ speed: 1 });
		service.state.isPlaying = true;
		service.state.sessionId = "s1";

		const keyMap = {
			1000: ["y"],
			2000: ["u"],
		};

		setTimeout(() => {
			service.configService.value.panel.speed = 2;
		}, 500);

		const playPromise = service._autoPlay(keyMap, "s1", 0);
		await jest.runAllTimersAsync();
		await playPromise;

		const calibration = 1.003;
		const firstDown = (1000 * calibration - 500) / 2 + 500;
		const firstUp = firstDown + (25 / 2);
		const secondDown = (2000 * calibration - 500) / 2 + 500;
		const secondUp = secondDown + (25 / 2);

		expectEventTimes(
			events,
			[
				{ key: "y", type: true, time: firstDown },
				{ key: "y", type: false, time: firstUp },
				{ key: "u", type: true, time: secondDown },
				{ key: "u", type: false, time: secondUp },
			],
			10
		);
	});

	it("handles speed decrease while keeping timeline", async () => {
		const service = createService({ speed: 2 });
		service.state.isPlaying = true;
		service.state.sessionId = "s1";

		const keyMap = {
			1000: ["y"],
			2000: ["u"],
		};

		setTimeout(() => {
			service.configService.value.panel.speed = 0.5;
		}, 500);

		const playPromise = service._autoPlay(keyMap, "s1", 0);
		await jest.runAllTimersAsync();
		await playPromise;

		const calibration = 1.003;
		const firstDown = 500 + ((1000 * calibration) - 1000) / 0.5;
		const firstUp = firstDown + (50 / 0.5);
		const secondDown = 500 + ((2000 * calibration) - 1000) / 0.5;
		const secondUp = secondDown + (50 / 0.5);

		expectEventTimes(
			events,
			[
				{ key: "y", type: true, time: firstDown },
				{ key: "y", type: false, time: firstUp },
				{ key: "u", type: true, time: secondDown },
				{ key: "u", type: false, time: secondUp },
			],
			20
		);
	});
});
