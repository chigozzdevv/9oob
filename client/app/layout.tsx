import { AppProvider } from "~~/providers/app-provider";
import "~~/app/globals.css";
import "@9oob/sdk/styles.css";
import { getMetadata } from "~~/services/metadata";

export const metadata = getMetadata({
  title: "9oob",
  description:
    "Embed natural language onchain actions in your Hedera app. Balance, swap, bridge and transfer through one guided conversation.",
});

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
};

export default RootLayout;
