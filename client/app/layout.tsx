import { AppProvider } from "~~/providers/app-provider";
import "~~/app/globals.css";
import "@9oob/sdk/styles.css";
import { getMetadata } from "~~/services/metadata";

export const metadata = getMetadata({
  title: "9oob",
  description:
    "Tell 9oob what you want to do. Review it, sign with your wallet, and track it to completion.",
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
