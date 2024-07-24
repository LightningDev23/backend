// ? Note: This is for when you have registered an account, it welcomes you and has a link to verify your email

import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Img,
	Link,
	Preview,
	Section,
	Text,
} from "@react-email/components";
import { imrUrl } from "./Image.tsx";

const styles = {
	main: {
		backgroundColor: "#161922",
		fontFamily: "sans-serif",
	},
	container: {
		backgroundColor: "#101319",
		color: "#CFDBFF",
		padding: "20px 20px 20px",
		margin: "0 auto",
	},
	logo: {
		icon: {
			width: "50px",
			height: "50px",
			borderRadius: "50%",
		},
		text: {
			fontSize: "2rem",
			fontWeight: "bold",
			marginLeft: "1rem",
		},
		container: {
			display: "flex",
			alignItems: "center",
		},
	},
	header: {
		fontSize: "1.2rem",
		lineHeight: "1.5rem",
	},
	paragraph: {
		fontSize: "1rem",
		lineHeight: "1.5rem",
	},
	btnContainer: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
	},
	btn: {
		backgroundColor: "#9AA9E0",
		color: "#161922",
		padding: "1rem",
		borderRadius: "1rem",
		textDecoration: "none",
		fontWeight: "bold",
		fontSize: ".8rem",
		// center
		display: "flex",
	},
	btnText: {
		textAlign: "center",
		fontSize: "0.8rem",
		color: "#CFDBFF",
	},
	hr: {
		// HR: Display a divider that separates content areas in your email.
		borderColor: "#262F40",
		margin: "15px 0",
	},
	footer: {
		fontSize: ".6rem",
		textAlign: "center",
	},
} as const;

const registration = (username: string, verifyUrl: string, deleteAccountUrl: string) => {
	return (
		<Html>
			<Head />
			<Preview>Welcome to Kastel, Verify your email to get started!</Preview>
			<Body style={styles.main}>
				<Container style={styles.container}>
					<div style={styles.logo.container}>
						<Img src={imrUrl} alt="Kastel Logo" style={styles.logo.icon} />
						<Heading style={styles.logo.text}>Kastel</Heading>
					</div>
					<Text style={styles.header}>Welcome to Kastel, {username}!</Text>
					<br />
					<Text style={styles.paragraph}>
						Thank you for signing up to Kastel. We are very excited to have you here, I hope you will enjoy our
						community.
					</Text>
					<br />
					<Hr style={styles.hr} />
					<Text style={styles.btnText}>
						Before you can truly enjoy Kastel, you'll need to verify your email. Don't worry, it's easy; Just click the
						link or button below.
					</Text>
					<Section style={styles.btnContainer}>
						<Button style={styles.btn} href={verifyUrl}>
							Verify Email
						</Button>
					</Section>
					<Text style={styles.footer}>
						If you did not sign up for kastel, please click on this link to delete the account{" "}
						<Link href={deleteAccountUrl}>Delete Account</Link>
					</Text>
				</Container>
			</Body>
		</Html>
	);
};

export default registration;
