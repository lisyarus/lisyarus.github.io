export class Matrix4 {
	constructor() {
		this.values = new Float32Array(16);
		this.values.fill(0.0);
	}

	static identity() {
		const result = new Matrix4();
		result.values[ 0] = 1.0;
		result.values[ 5] = 1.0;
		result.values[10] = 1.0;
		result.values[15] = 1.0;
		return result;
	}

	static translation(vector) {
		const result = Matrix4.identity();
		result.values[ 3] = vector[0];
		result.values[ 7] = vector[1];
		result.values[11] = vector[2];
		return result;
	}

	static scaling(vector) {
		const result = Matrix4.identity();
		result.values[ 0] = vector[0];
		result.values[ 5] = vector[1];
		result.values[10] = vector[2];
		return result;
	}

	static rotationXY(angle) {
		const result = Matrix4.identity();
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		result.values[0] =  c;
		result.values[1] = -s;
		result.values[4] =  s;
		result.values[5] =  c;
		return result;
	}

	static rotationYZ(angle) {
		const result = Matrix4.identity();
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		result.values[ 5] =  c;
		result.values[ 6] = -s;
		result.values[ 9] =  s;
		result.values[10] =  c;
		return result;
	}

	static rotationZX(angle) {
		const result = Matrix4.identity();
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		result.values[ 0] =  c;
		result.values[ 2] =  s;
		result.values[ 8] = -s;
		result.values[10] =  c;
		return result;
	}

	static perspective(xfov, yfov, near, far) {
		const result = new Matrix4();
		result.values[ 0] = 1.0 / Math.tan(xfov / 2.0);
		result.values[ 5] = 1.0 / Math.tan(yfov / 2.0);
		result.values[10] = - (far + near) / (far - near);
		result.values[11] = - 2.0 * far * near / (far - near);
		result.values[14] = - 1.0;
		return result;
	}

	add(other) {
		const result = new Matrix4();
		for (var i = 0; i < 16; i += 1) {
			result.values[i] = this.values[i] + other.values[i];
		}
		return result;
	}

	sub(other) {
		const result = new Matrix4();
		for (var i = 0; i < 16; i += 1) {
			result.values[i] = this.values[i] - other.values[i];
		}
		return result;
	}

	mult(other) {
		const result = new Matrix4();
		for (var i = 0; i < 4; i += 1) {
			for (var j = 0; j < 4; j += 1) {
				for (var k = 0; k < 4; k += 1) {
					result.values[4 * i + j] += this.values[4 * i + k] * other.values[4 * k + j];
				}
			}
		}
		return result;
	}

	transpose() {
		const result = new Matrix4();
		for (var i = 0; i < 4; i += 1) {
			for (var j = 0; j < 4; j += 1) {
				result.values[4 * i + j] = this.values[4 * j + i];
			}
		}
		return result;
	}

	copy() {
		const result = new Matrix4();
		for (var i = 0; i < 16; i += 1) {
			result.values[i] = this.values[i];
		}
		return result;
	}

	print() {
		console.log(this.values[ 0].toFixed(3), this.values[ 1].toFixed(3), this.values[ 2].toFixed(3), this.values[ 3].toFixed(3));
		console.log(this.values[ 4].toFixed(3), this.values[ 5].toFixed(3), this.values[ 6].toFixed(3), this.values[ 7].toFixed(3));
		console.log(this.values[ 8].toFixed(3), this.values[ 9].toFixed(3), this.values[10].toFixed(3), this.values[11].toFixed(3));
		console.log(this.values[12].toFixed(3), this.values[13].toFixed(3), this.values[14].toFixed(3), this.values[15].toFixed(3));
	}

	inverse() {
		const result = Matrix4.identity();
		const self = this.copy();

		for (var i = 0; i < 4; i += 1) {
			var k = i;
			for (var j = i + 1; j < 4; j += 1) {
				if (Math.abs(self.values[4 * j + i]) > Math.abs(self.values[4 * k + i])) {
					k = j;
				}
			}

			if (i != k) {
				for (var j = i; j < 4; j += 1) {
					const temp = self.values[4 * i + j];
					self.values[4 * i + j] = self.values[4 * k + j];
					self.values[4 * k + j] = temp;
				}

				for (var j = 0; j < 4; j += 1) {
					const temp = result.values[4 * i + j];
					result.values[4 * i + j] = result.values[4 * k + j];
					result.values[4 * k + j] = temp;
				}
			}
			k = undefined;


			const r = self.values[4 * i + i];
			for (var j = i; j < 4; j += 1) {
				self.values[4 * i + j] /= r;
			}
			for (var j = 0; j < 4; j += 1) {
				result.values[4 * i + j] /= r;
			}

			for (var k = i + 1; k < 4; k += 1) {
				const r = self.values[4 * k + i];
				for (var j = i; j < 4; j += 1) {
					self.values[4 * k + j] -= r * self.values[4 * i + j];
				}

				for (var j = 0; j < 4; j += 1) {
					result.values[4 * k + j] -= r * result.values[4 * i + j];
				}
			}
		}

		for (var i = 3; i >= 0; i -= 1) {
			for (var j = 0; j < i; j += 1) {
				const r = self.values[4 * j + i];
				for (var k = 0; k < 4; k += 1) {
					result.values[4 * j + k] -= r * result.values[4 * i + k];
				}
			}
		}

		return result;
	}

	norm() {
		var result = 0.0;

		for (var i = 0; i < 16; i += 1) {
			result += this.values[i] * this.values[i];
		}

		return Math.sqrt(result);
	}
}