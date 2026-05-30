from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, Index
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class OfferRecord(Base):
    __tablename__ = "offer_records"
    __table_args__ = (
        Index("ix_offer_asin_timestamp", "asin", "timestamp"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asin: Mapped[str] = mapped_column(String(32), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    domain: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(Text, default="")
    image: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[str] = mapped_column(String(64), default="N/A")
    currency: Mapped[str] = mapped_column(String(16), default="")
    price_display: Mapped[str] = mapped_column(String(128), default="N/A")
    is_main: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def to_api_dict(self) -> dict:
        return {
            "id": self.id,
            "ASIN": self.asin,
            "Timestamp": self.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "Domain": self.domain,
            "Name": self.name,
            "Image": self.image,
            "Price": self.price,
            "Currency": self.currency,
            "Price Display": self.price_display,
            "Is Main": self.is_main,
        }
