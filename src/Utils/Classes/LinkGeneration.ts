/* !
 *   ██╗  ██╗ █████╗ ███████╗████████╗███████╗██╗
 *   ██║ ██╔╝██╔══██╗██╔════╝╚══██╔══╝██╔════╝██║
 *  █████╔╝ ███████║███████╗   ██║   █████╗  ██║
 *  ██╔═██╗ ██╔══██║╚════██║   ██║   ██╔══╝  ██║
 * ██║  ██╗██║  ██║███████║   ██║   ███████╗███████╗
 * ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚══════╝
 * Copyright(c) 2022-2023 DarkerInk
 * GPL 3.0 Licensed
 */

import crypto from "node:crypto";
import { Snowflake as SnowflakeBuilder, Base64 } from "@kastelll/util";
import { encryption } from "../../Config.ts";
import Constants from "../../Constants.ts";
import App from "./App.ts";

const snowflake = new SnowflakeBuilder(Constants.snowflake);

class LinkGeneration {
	public static VerifcationLink(snowflakeId: string): string {
		const currentDate = Date.now();

		const nonce = Base64.OldBase64(crypto.randomBytes(16).toString("base64"));
		const snowflake = Base64.Encode(snowflakeId);

		const hmac = crypto.createHmac("sha256", encryption.TokenKey);

		hmac.update(`${snowflake}.${currentDate}.${nonce}`);

		const secret = Base64.OldBase64(hmac.digest("base64"));

		return Base64.Encode(`${snowflake}.${Base64.Encode(String(currentDate))}.${nonce}.${secret}`);
	}

	public static Verify(link: string): boolean {
		const decodedLink = Base64.Decode(link);

		const [base64snowflake, base64createdDate, nonce, secret] = decodedLink.split(".");

		if (!base64snowflake || !base64createdDate || !nonce || !secret) return false;

		const decodedSnowflake = Base64.Decode(base64snowflake);
		const createdDate = Base64.Decode(base64createdDate);

		App.StaticLogger.debug("Snowflake", decodedSnowflake);

		if (!snowflake.Validate(decodedSnowflake)) return false;

		App.StaticLogger.debug("Snowflake good");

		const createdDateParsed = new Date(createdDate);

		// the max age of these will be around 2 weeks (MAX) so just hard code the check here
		if (createdDateParsed.getTime() + 1_209_600_000 < Date.now()) return false;

		App.StaticLogger.debug("Date good");

		const hmac = crypto.createHmac("sha256", encryption.TokenKey);

		hmac.update(`${base64snowflake}.${base64createdDate}.${nonce}`);

		const newsecret = Base64.OldBase64(hmac.digest("base64"));

		App.StaticLogger.debug("New Secret", newsecret);
		App.StaticLogger.debug("Old Secret", secret);

		if (newsecret !== secret) return false;

		App.StaticLogger.debug("New vs Old = Yes");

		if (link !== Base64.Encode(`${base64snowflake}.${base64createdDate}.${nonce}.${secret}`)) return false;

		App.StaticLogger.debug("Verified Link");

		return true;
	}

	public static GetSnowflake(link: string): string | null {
		const decodedLink = Base64.Decode(link);

		const [base64snowflake, base64createdDate, nonce, secret] = decodedLink.split(".");

		if (!base64snowflake || !base64createdDate || !nonce || !secret) return null;

		const decodedSnowflake = Base64.Decode(base64snowflake);

		if (!snowflake.Validate(decodedSnowflake)) return null;

		return decodedSnowflake;
	}
}

export { LinkGeneration };

export default LinkGeneration;
