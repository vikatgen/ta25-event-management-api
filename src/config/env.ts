import z from "zod";

const envSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]),
	PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
	DATABASE_URL: z.url(),
	BETTER_AUTH_SECRET: z.string().min(32),
	BETTER_AUTH_URL: z.url(),
});

const parseEnv = () => {
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		process.exit(1);
	}
	return result.data;
};

export const env = parseEnv();
