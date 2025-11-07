export interface DataPacket {
  timestamp: number;
  type: 'market-data' | 'sensor-reading' | 'ai-inference';
  data: any;
  sequenceNumber: number;
}

export class DataGenerator {
  private sequence: number = 0;

  generatePacket(): DataPacket {
    this.sequence++;

    const types: DataPacket['type'][] = ['market-data', 'sensor-reading', 'ai-inference'];
    const type = types[Math.floor(Math.random() * types.length)];

    return {
      timestamp: Date.now(),
      type,
      data: this.generateDataForType(type),
      sequenceNumber: this.sequence
    };
  }

  private generateDataForType(type: DataPacket['type']): any {
    switch (type) {
      case 'market-data':
        return {
          symbol: 'SOL/USDC',
          price: 100 + Math.random() * 50,
          volume: Math.floor(Math.random() * 1000000),
          change24h: (Math.random() - 0.5) * 10
        };

      case 'sensor-reading':
        return {
          temperature: 20 + Math.random() * 15,
          humidity: 40 + Math.random() * 40,
          pressure: 1000 + Math.random() * 50
        };

      case 'ai-inference':
        return {
          model: 'gpt-4-turbo',
          tokens: Math.floor(Math.random() * 500),
          latency: Math.floor(Math.random() * 2000),
          confidence: 0.8 + Math.random() * 0.2
        };
    }
  }
}