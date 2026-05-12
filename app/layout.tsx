import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Why LG 번역 적용 툴",
    description:
        "엑셀파일의 첫번 째 시트 내용을 html요소에 반영합니다.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ko">
            <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
                {children}
            </body>
        </html>
    );
}
