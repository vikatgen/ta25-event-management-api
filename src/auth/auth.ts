import {betterAuth} from "better-auth";
import {env} from "../config/env.js";
import {drizzleAdapter} from "@better-auth/drizzle-adapter";
import {db} from "../db/index.js";
import * as schema from "../db/schema/auth.js";
import {ROLES} from "./roles.js";

export const auth = betterAuth({
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
	advanced: {
		database: {
			generateId: "uuid",
		},
	},
	user: {
		additionalFields: {
			role: {
				type: [...ROLES],
				required: false,
				defaultValue: "attendee",
				input: false,
			},
		},
	},
});
