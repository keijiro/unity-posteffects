Shader "Post FX/SeparableBlur" {
	Properties {
		_MainTex ("Base", 2D) = "" {}
	}

	Subshader {
		Pass {
			Cull Off
			ZTest Always
			ZWrite Off
			Fog { Mode off }

			GLSLPROGRAM

			uniform sampler2D _MainTex;
			uniform vec4 offsets;
			varying vec2 uv;
			varying vec4 delta[3];

			#ifdef VERTEX
			void main() {
	            gl_Position = gl_ModelViewProjectionMatrix * gl_Vertex;
				uv = gl_MultiTexCoord0.xy;
				delta[0] = gl_MultiTexCoord0.xyxy + offsets.xyxy * vec4(1, 1, -1, -1);
				delta[1] = gl_MultiTexCoord0.xyxy + offsets.xyxy * vec4(2, 2, -2, -2);
				delta[2] = gl_MultiTexCoord0.xyxy + offsets.xyxy * vec4(3, 3, -3, -3);
			}
			#endif

			#ifdef FRAGMENT
			void main() {
				gl_FragColor =
					0.4  * texture2D(_MainTex, uv) +
					0.15 * texture2D(_MainTex, delta[0].xy) +
					0.15 * texture2D(_MainTex, delta[0].zw) +
					0.1  * texture2D(_MainTex, delta[1].xy) +
					0.1  * texture2D(_MainTex, delta[1].zw) +
					0.05 * texture2D(_MainTex, delta[2].xy) +
					0.05 * texture2D(_MainTex, delta[2].zw);
			}
			#endif

			ENDGLSL
		}
	}
}
